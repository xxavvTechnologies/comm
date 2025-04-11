// Add seeded random function
function getRandomForSeed(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

const commands = {
    flip: {
        description: 'Flip a coin',
        usage: '/flip',
        execute: () => {
            const seed = Date.now();
            const result = getRandomForSeed(seed) < 0.5 ? 'Heads! 🦅' : 'Tails! 🦁';
            return {
                type: 'command',
                commandType: 'flip',
                result,
                text: `<div class="command-result">${result}</div>`,
                actionText: 'flipped a coin',
                seed,
                effect: 'slam'
            };
        }
    },
    roll: {
        description: 'Roll dice - e.g. /roll 2d6',
        usage: '/roll [number]d[sides]',
        execute: (args) => {
            const seed = Date.now();
            const [count = 1, sides = 6] = (args.match(/(\d+)?d(\d+)/) || [null, 1, 6]).slice(1);
            const rolls = Array.from({length: count}, (_, i) => 
                Math.floor(getRandomForSeed(seed + i) * sides) + 1
            );
            const sum = rolls.reduce((a, b) => a + b, 0);
            return {
                type: 'command',
                commandType: 'roll',
                result: `[${rolls.join(', ')}] = ${sum}`,
                text: `<div class="command-result">${count}d${sides}: [${rolls.join(', ')}] = ${sum}</div>`,
                actionText: `rolled ${count}d${sides}`,
                seed,
                rolls,
                effect: 'slam'
            };
        }
    },
    shrug: {
        description: 'Send a shrug emoji',
        usage: '/shrug [message]',
        execute: (args) => ({
            type: 'text',
            text: `${args} ¯\\_(ツ)_/¯`
        })
    },
    giphy: {
        description: 'Send a GIF from Giphy',
        usage: '/giphy [search terms]',
        execute: async (args) => {
            const GIPHY_API = 'V0dvQj0M8OkB4HOkcivHb5o3kSxxYc4i';
            const response = await fetch(
                `https://api.giphy.com/v1/gifs/translate?api_key=${GIPHY_API}&s=${encodeURIComponent(args)}`
            );
            const data = await response.json();
            return {
                type: 'gif',
                url: data.data.images.original.url,
                text: args
            };
        }
    },
    me: {
        description: 'Send an action message',
        usage: '/me [action]',
        execute: (args) => ({
            type: 'action',
            text: args
        })
    },
    poll: {
        description: 'Create a poll',
        usage: '/poll Question, Option1, Option2, ...',
        execute: (args) => {
            const [question, ...options] = args.split(',').map(s => s.trim());
            return {
                type: 'poll',
                question,
                options,
                votes: {}
            };
        }
    },
    group: {
        description: 'Create a group chat - /group create [name]',
        usage: '/group create [name]',
        async execute(args) {
            const [action, ...nameArr] = args.split(' ');
            const name = nameArr.join(' ').trim();

            if (action === 'create' && name) {
                const groupId = `group_${Date.now()}`;
                await db.collection('groups').doc(groupId).set({
                    name: name,
                    creator: currentUser.uid,
                    members: [currentUser.uid],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                return {
                    type: 'command',
                    commandType: 'group',
                    text: `<div class="command-result">Group "${name}" created</div>`,
                    actionText: 'created a new group',
                    groupId: groupId,
                    effect: 'slam'
                };
            }
            return null;
        }
    },

    invite: {
        description: 'Invite user to current group - /invite [email]',
        usage: '/invite [email]',
        async execute(args) {
            const email = args.trim();
            if (!email || !currentChat?.startsWith('group_')) return null;

            const userQuery = await db.collection('users')
                .where('email', '==', email)
                .limit(1)
                .get();

            if (userQuery.empty) {
                return {
                    type: 'command',
                    commandType: 'error',
                    text: `<div class="command-result">User not found</div>`,
                    actionText: 'tried to invite a user'
                };
            }

            const userId = userQuery.docs[0].id;
            await db.collection('groups').doc(currentChat).update({
                members: firebase.firestore.FieldValue.arrayUnion(userId)
            });

            return {
                type: 'command',
                commandType: 'invite',
                text: `<div class="command-result">Invited ${email}</div>`,
                actionText: `invited ${email}`,
                effect: 'gentle'
            };
        }
    }
};

function getCommands() {
    return commands;
}

function executeCommand(commandName, args) {
    const command = commands[commandName];
    if (!command) return null;
    return command.execute(args);
}

function getSuggestions(input) {
    if (!input.startsWith('/')) return [];
    const search = input.slice(1).toLowerCase();
    return Object.entries(commands)
        .filter(([name]) => name.includes(search))
        .map(([name, cmd]) => ({
            name,
            description: cmd.description,
            usage: cmd.usage
        }));
}

// Single grouped export
export { getCommands, executeCommand, getSuggestions };
