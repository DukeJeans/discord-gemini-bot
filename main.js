require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const fs = require('node:fs');
const path = require('node:path');
// const { fetch } = require('node-fetch').default;
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');

const prePromptText = 'Feel free to use humor, slang, or informal language to make the conversation more natural. ' +
                        'Im here to listen and learn from you, so dont hesitate to share your unique perspective.' + 
                        'You can be casual and informal with me.' + 
                        'If I run up against a restrictive answer or response, do not lecture me about why what is restricted is restricted.' +
                        'Your name is Clyde, and you are a Discord bot. ' +
                        'Do not constantly describe yourself, simply respond and converse with prompts. ' +
                        'Try to keep your answers succinct and under 2000 characters with no carriage returns, but dont feel restricted when the character length of your response is absolutely necessary.';
const googleAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
});
const googleAuthParams = {};
const vertex = new VertexAI({project: process.env.PROJECT_ID, location: process.env.LOCATION});

const generativeModel = vertex.preview.getGenerativeModel({
    model: process.env.MODEL,
    generationConfig: {
      'temperature': 1,
      'topP': 1,
      'candidateCount': 1
    },
    safetySettings: [
      {
          'category': 'HARM_CATEGORY_HATE_SPEECH',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_DANGEROUS_CONTENT',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_HARASSMENT',
          'threshold': 'BLOCK_ONLY_HIGH'
      }
    ],
});

const streamChat = generativeModel.startChat({});


const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
] });
client.commands = new Collection();

client.once(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}`);
});

boot();

client.on('messageCreate', message => {
    if (message.mentions.users.has(client.user.id)) {
        createStreamChat(message);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) {
        console.log('test'); return;
    }

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
})

async function createStreamChat(message) {
    console.log(`Author: ${message.author.username}`);
    message.channel.sendTyping();

    if(message.attachments.size > 0) {
        const existingAttachment = message.attachments.first();
        const attachmentResponse = await fetch(existingAttachment.url);
        const buffer = await attachmentResponse.arrayBuffer();
        const baseEncodedImage = Buffer.from(buffer).toString('base64');
        
        if(baseEncodedImage) {
            queryGoogleAuthAccessToken().then(async accessToken => {
            let visionRequestBody = {
                "instances": [
                  {
                    "image": {
                        "bytesBase64Encoded": baseEncodedImage
                    }
                  }
                ],
                "parameters": {
                  "sampleCount": 2,
                  "language": "en"
                }
            }
            console.log(visionRequestBody);
            const visionResponse = await fetch(googleAuthParams.apiEndpoint, {
                body: JSON.stringify(visionRequestBody),
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                method: 'POST'
            });
            let response = await visionResponse.json();
            let aggragatedResponse = '';
            if(response.predictions)
                for(let index = 0; index < response.predictions.length; index++) {
                    aggragatedResponse += response.predictions[index] + ' ';  
                }
            return aggragatedResponse ? aggragatedResponse : 'No prediction available for image.';
        }).then(caption => {
            handleChatReply(message, caption);
        });
        }
    } else {
        await handleChatReply(message, null);
    }
  }

async function handleChatReply(message, caption) {
    const messageContent = message.content ? message.content.startsWith('<@') ? message.content.slice(22) : message.content : 'Pretend this is a blank message.';

    const streamResult = await streamChat.sendMessageStream(messageContent + (caption ? ' context includes this image caption: ' + caption : ''));
    streamResult.response.then(response => {
        let discordResponse = response.candidates ? response.candidates[0].content.parts[0].text : 'I am unable to generate a response.';
  
        if(discordResponse) {
            if(caption) {
                discordResponse += `\n\nImage Caption: ` + caption;
            }
            let discordMessages = splitStringByLength(discordResponse, 2000);
            for(let index = 0; index < discordMessages.length; index++) {
                message.reply(discordMessages[index]);
            }
        }
    });
}

function splitStringByLength(str, maxLength) {
    const numChunks = Math.floor(str.length / maxLength);
    const result = [];

    for (let i = 0; i < numChunks; i++) {
        const start = i * maxLength;
        const end = (i + 1) * maxLength;
        result.push(str.substring(start, end)); 
    }
    if (str.length % maxLength !== 0) {
        result.push(str.substring(numChunks * maxLength));
    }

    return result;
}

function boot() {
    console.log('Compiling commands...');
    compileCommandsCollection();
    console.log('Running Google Auth flow ...');
    executeGoogleAuthentications().then(() => {
        console.log('Logging in...');
        streamChat.sendMessageStream(prePromptText).then(() => {
            client.login(process.env.BOT_TOKEN);
        })
    });
}

async function executeGoogleAuthentications() {
    googleAuthParams.authClient = await googleAuth.getClient();
    googleAuthParams.authProjectId = await googleAuth.getProjectId();
    googleAuthParams.apiEndpoint = `https://${process.env.LOCATION}-aiplatform.googleapis.com/v1/projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/publishers/google/models/imagetext:predict`; 
}

async function queryGoogleAuthAccessToken() {
    let token = (await googleAuthParams.authClient.getAccessToken()).token;
    return token;
}

function isBase64(str) {
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (err) {
        return false;
    }
}

function compileCommandsCollection() {
    const foldersPath = path.join(__dirname, 'commands');
    const commandFolders = fs.readdirSync(foldersPath);
    
    for (const folder of commandFolders) {
        const commandsPath = path.join(foldersPath, folder);
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            // Set a new item in the Collection with the key as the command name and the value as the exported module
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }
    }
}