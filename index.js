const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

app.post('/minecraft', (req, res) => {
    const { message } = req.body;
    const channelId = 'YOUR_DISCORD_CHANNEL_ID';
    const channel = client.channels.cache.get(channelId);

    if (channel) {
        channel.send(`Minecraft says: ${message}`);
    }

    res.sendStatus(200);
});

client.login('YOUR_DISCORD_BOT_TOKEN');

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
