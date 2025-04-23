import express from "express";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { Issuer, TokenSet, custom, generators } from "openid-client";
import cookieParser from "cookie-parser";
import {} from 'dotenv/config';

// Express setup
const app = express();
const port = 3000;
const clientId = process.env.ROBLOX_CLIENT_ID;
const clientSecret = process.env.ROBLOX_CLIENT_SECRET;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

// Discord setup
const discordToken = process.env.DISCORD_BOT_TOKEN;
const discordClientId = process.env.DISCORD_CLIENT_ID;

// Cookie configuration
const cookieSecret = process.env.COOKIE_SECRET || generators.random();
const secureCookieConfig = {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    signed: true,
};

// Map to store pending links between Discord users and auth sessions
const pendingLinks = new Map();

// Middleware
app.use(cookieParser(cookieSecret));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup Discord bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Register slash command
async function registerCommands() {
    const commands = [
        {
            name: 'link',
            description: 'Link your Roblox account'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(discordToken);

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(discordClientId),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

async function main() {
    // Discover OpenID configuration
    const issuer = await Issuer.discover(
        "https://apis.roblox.com/oauth/.well-known/openid-configuration"
    );

    const oidcClient = new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [`${baseUrl}/oauth/callback`],
        response_types: ["code"],
        scope: "openid profile",
        id_token_signed_response_alg: "ES256",
    });

    oidcClient[custom.clock_tolerance] = 180;

    // Discord bot event handlers
    client.once('ready', () => {
        console.log(`Discord bot logged in as ${client.user.tag}`);
        registerCommands();
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        if (interaction.commandName === 'link') {
            const discordUserId = interaction.user.id;
            const discordUsername = interaction.user.username;
            const linkId = generators.random();
            
            // Store the interaction for later response
            pendingLinks.set(linkId, {
                discordUserId,
                discordUsername,
                interaction: interaction,
                channelId: interaction.channelId,
                responded: false
            });

            // Create auth URL with linkId as state
            const authUrl = `${baseUrl}/login/${linkId}`;
            
            await interaction.reply({
                content: `Click this link to connect your Roblox account: ${authUrl}`,
                ephemeral: true
            });
        }
    });

    // Express routes
    app.get("/login/:linkId", (req, res) => {
        const linkId = req.params.linkId;
        
        // Check if this linkId exists in our pending links
        if (!pendingLinks.has(linkId)) {
            return res.status(400).send("Invalid or expired link. Please request a new link from Discord.");
        }

        const state = linkId;  // Use linkId as state
        const nonce = generators.nonce();

        res
            .cookie("state", state, secureCookieConfig)
            .cookie("nonce", nonce, secureCookieConfig)
            .redirect(
                oidcClient.authorizationUrl({
                    scope: oidcClient.scope,
                    state,
                    nonce,
                })
            );
    });

    app.get("/oauth/callback", async (req, res) => {
        try {
            const params = oidcClient.callbackParams(req);
            const linkId = params.state;

            // Verify this is a valid pending link
            if (!pendingLinks.has(linkId)) {
                return res.status(400).send("Authentication failed: Invalid or expired link.");
            }

            const linkData = pendingLinks.get(linkId);

            const tokenSet = await oidcClient.callback(
                `${baseUrl}/oauth/callback`,
                params,
                {
                    state: req.signedCookies.state,
                    nonce: req.signedCookies.nonce,
                }
            );

            // Get user info from Roblox
            const userInfo = await oidcClient.userinfo(tokenSet);
            console.log("User info:", userInfo);

            // Send confirmation to Discord
            if (!linkData.responded) {
                const interaction = linkData.interaction;
                if (interaction.isRepliable()) {
                    await interaction.followUp({
                        content: `Is this your Roblox account?\nUsername: ${userInfo.preferred_username || userInfo.name}\nUser ID: ${userInfo.sub}`,
                        ephemeral: true
                    });
                    linkData.responded = true;
                } else {
                    // If we can't reply to the original interaction (it might have timed out)
                    try {
                        const channel = await client.channels.fetch(linkData.channelId);
                        if (channel && channel.isTextBased()) {
                            await channel.send({
                                content: `<@${linkData.discordUserId}>, is this your Roblox account?\nUsername: ${userInfo.preferred_username || userInfo.name}\nUser ID: ${userInfo.sub}`,
                            });
                        }
                    } catch (error) {
                        console.error("Failed to send message to Discord channel:", error);
                    }
                }
            }

            // Here you would typically store the link between Discord user ID and Roblox user ID in a database
            console.log(`Linked Discord user ${linkData.discordUsername} (${linkData.discordUserId}) with Roblox user ${userInfo.preferred_username || userInfo.name} (${userInfo.sub})`);

            // Remove the pending link
            pendingLinks.delete(linkId);

            // Clear cookies and show success message
            res
                .clearCookie("state")
                .clearCookie("nonce")
                .send("Success! Your Roblox account has been linked. You can close this window and return to Discord.");
        } catch (error) {
            console.error("Error in callback:", error);
            res.status(500).send("Authentication failed. Please try again.");
        }
    });

    // Start Express server
    app.listen(port, () => {
        console.log(`Express server is running on port: ${port}`);
    });

    // Login to Discord
    client.login(discordToken);
}

main().catch(console.error);