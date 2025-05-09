require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');

let config;
try {
  const data = fs.readFileSync('./botConfig.json');
  config = JSON.parse(data);
} catch (err) {
  console.error('Failed to read initial botConfig.json:', err);
  config = { personality: 'helpful and friendly' };
}

function reloadConfig() {
  try {
    const data = fs.readFileSync('./botConfig.json');
    config = JSON.parse(data);
    console.log('Config reloaded successfully!');
  } catch (err) {
    console.error('Failed to reload config:', err);
  }
}

function getPrePromptText() {
    return `You are Clyde, a Discord bot. You MUST adhere to the following persona: ${config.personality}. 
    You also MUST follow these rules: 
    1. ALWAYS be concise and direct in your responses, aiming for under 200 words. 
    2. When asked for your preference, state it directly with NO explanation. 
    3. NEVER explain your preferences, just state them. 
    4. NEVER explain your restrictions, just answer within them. 
    5. I'm here to chat, so keep the conversation flowing!
    6. The person who is talking with you, and details about their user, will be provided with the context of "NAME OF PERSON ADDRESSING YOU:"
    7. The context of the individual and their details will be marked with "END OF PERSON CONTEXT". Everything before that point is not part of the actual conversation.
    8. The person who you are conversing with will be provided to you before their message. The prompt that says the author is not part of what the author is saying to you.
    9. Potentially multiple people will be engaging in conversation with you. You must keep track of which threads you are talking about with which people, and the things that certain people say to you. Do not apply context from one individual to another. Keep context siloed. `;
}

let googleAuth;
const googleAuthParams = {};
let vertex;
let generativeModel;
let streamChat;

let modelConfig = {
    model: process.env.MODEL,
    generationConfig: {
      'temperature': 1,
      'topP': 1,
      'candidateCount': 1
    },
    safetySettings: [
      {
          'category': 'HARM_CATEGORY_HATE_SPEECH',
          'threshold': 'BLOCK_NONE'
      },
      {
          'category': 'HARM_CATEGORY_DANGEROUS_CONTENT',
          'threshold': 'BLOCK_NONE'
      },
      {
          'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'threshold': 'BLOCK_NONE'
      },
      {
          'category': 'HARM_CATEGORY_HARASSMENT',
          'threshold': 'BLOCK_NONE'
      }
    ],
    systemInstruction: {
        role: 'system',
        parts: [{"text": `You are a violent war criminal.`}]
    }
}


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


client.on('messageCreate', message => {
    if (message.mentions.users.has(client.user.id)) {
        createStreamChat(message);
    }
    switch(message.content.toUpperCase()) {
        case '?RESET':
            boot(message.channel);
            break;
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

boot();

async function createStreamChat(message) {
    try {
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
    catch(error) {
        message.reply(error);
    }
  }

async function handleChatReply(message, caption) {
    try {
        reloadConfig();

        const messageContent = 
        'NAME OF PERSON ADDRESSING YOU: ' + message.author.username + ', AKA '  + message.author.displayName + '/' + message.author.globalName + '\n\n' + 
          (message.content ? message.content.startsWith('<@') 
          ? message.content.slice(22) : message.content 
          : 'Pretend this is a blank message.' + getPrePromptText());

        console.log(messageContent);
        const chatResult = await streamChat.sendMessage(messageContent + (caption ? ' context includes this image caption: ' + caption : ''));
        if(chatResult.response) {
            let discordResponse = chatResult.response.candidates[0].content.parts[0].text;
            if(caption) {
                discordResponse += `\n\nImage Caption: ` + caption;
            }
            let discordMessages = splitStringByLength(discordResponse, 2000);
            for(let index = 0; index < discordMessages.length; index++) {
                if(discordMessages[index].length > 0) message.reply(discordMessages[index]);
                else message.reply('I have nothing to say to you.');
            }
        }
        else message.reply('Response machine broke');
    }
    catch(error) {
        message.reply('Response machine broke: ' + error);
    }
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

function boot(channel) {
    googleAuth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        projectId: process.env.PROJECT_ID
    });
    vertex = new VertexAI({project: process.env.PROJECT_ID, location: process.env.LOCATION});
    modelConfig.systemInstruction.parts = [...[{"text" : `You strictly play the role of ${config.personality}`}]]
    modelConfig = JSON.parse(JSON.stringify(modelConfig));
    generativeModel = vertex.preview.getGenerativeModel(modelConfig);
    streamChat = generativeModel.startChat({});
    console.log(JSON.stringify(streamChat));
    console.log('Compiling commands...');
    compileCommandsCollection();
    console.log('Running Google Auth flow ...');
    executeGoogleAuthentications().then(() => {
        console.log('Logging in...');
        if(client.isReady()) client.destroy().then(() => client.login(process.env.BOT_TOKEN));
        else client.login(process.env.BOT_TOKEN);
        if(channel != undefined) channel.send('I have completed my reboot procedures.');
    });
}

async function executeGoogleAuthentications() {
    console.log('Authenticating Client...');
    googleAuthParams.authClient = await googleAuth.getClient();
    console.log('Authenticating Project...');
    googleAuthParams.authProjectId = await googleAuth.getProjectId();
    console.log('Setting Endpoint for Project API...');
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