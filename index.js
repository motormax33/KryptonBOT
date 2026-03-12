// =================================
//
// Importing Libraries
//
// =================================
//
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const db = require('./database.js');
const config = require('./config.json');
const axios = require('axios');

// =================================
//
// Bot Initialization
//
// =================================
//
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message]
});

// =================================
//
// Helper Variables
//
// =================================
//
const generateRandomString = (length) => Math.random().toString(36).substring(2, 2 + length).toUpperCase();

const parseDuration = (durationStr) => {
    const match = durationStr.match(/^(\d+)([dmy])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const date = new Date();
    if (unit === 'd') date.setDate(date.getDate() + value);
    else if (unit === 'm') date.setMonth(date.getMonth() + value);
    else if (unit === 'y') date.setFullYear(date.getFullYear() + value);
    else return null;
    return date;
};

// Function for IP geolocation
async function getCountryFromIP(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}?fields=country,countryCode`);
        if (response.data && response.data.country) {
            return response.data.country;
        }
    } catch (error) {
        console.error('Geolocation error:', error);
    }
    return 'Unknown';
}

// Sorting definitions
const SORT_TYPES = {
    DEFAULT: 'default',
    TEMP: 'temp',
    PRIVATE: 'private',
    PUBLIC: 'public',
    PERM: 'perm'
};

const SORT_DISPLAY_NAMES = {
    [SORT_TYPES.DEFAULT]: 'Default',
    [SORT_TYPES.TEMP]: 'TEMP',
    [SORT_TYPES.PRIVATE]: 'Private',
    [SORT_TYPES.PUBLIC]: 'Public',
    [SORT_TYPES.PERM]: 'Perm'
};

const SORT_ORDER = [SORT_TYPES.DEFAULT, SORT_TYPES.TEMP, SORT_TYPES.PRIVATE, SORT_TYPES.PUBLIC, SORT_TYPES.PERM];

// =================================
//
// Slash Commands Definitions
//
// =================================
//
const commands = [
    {
        name: 'generate-license',
        description: 'Generates a new license key (Admin only).',
    },
    {
        name: 'reset-discord',
        description: 'Unlinks the Discord account from your license key.',
    },
    {
        name: 'reset-hwid',
        description: 'Resets the HWID linked to your license key.',
    },
    {
        name: 'license-delete',
        description: 'Deletes a license key permanently (Admin only).',
    },
    {
        name: 'admin-hwid',
        description: 'ADMIN: Resets the HWID for a given license key.'
    },
    {
        name: 'admin-discord',
        description: 'ADMIN: Resets the Discord ID for a given license key.'
    },
    {
        name: 'licenses-check',
        description: 'Check all licenses or a specific license (Admin only).',
        options: [
            {
                name: 'license',
                type: 3,
                description: 'Specific license key to check (optional)',
                required: false
            }
        ]
    },
    {
        name: 'stats',
        description: 'Show detailed statistics about licenses and users'
    },
    // NEW COMMANDS
    {
        name: 'freeze',
        description: 'Freeze licenses (Admin only).'
    },
    {
        name: 'unfreeze',
        description: 'Unfreeze licenses (Admin only).'
    },
    {
        name: 'addtime',
        description: 'Add time to licenses (Admin only).'
    }
];

// =================================
//
// Bot Event: Ready
//
// =================================
//
client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
    await db.initializeDatabase();

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.guildId),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    const redeemChannel = client.channels.cache.get(config.redeemChannelId);
    if (redeemChannel && redeemChannel.isTextBased()) {
        try {
            const messages = await redeemChannel.messages.fetch({ limit: 100 });
            await redeemChannel.bulkDelete(messages, true);

            const embed = new EmbedBuilder()
                .setTitle("Redeem Customer Role")
                .setDescription('> To redeem a customer role, click the **"Redeem"** button\n> and then enter your license key.')
                .setColor("Green");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('redeem_key_button')
                    .setLabel('Redeem')
                    .setStyle(ButtonStyle.Success)
            );

            await redeemChannel.send({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error("Error setting up #redeem channel:", error);
        }
    } else {
        console.log("Redeem channel not found or not a text channel.");
    }

    await initializeStatsChannels();
    setInterval(updateStatsChannels, 5 * 60 * 1000);
});

// =================================
//
// Statistics Channels Functions
//
// =================================
//
async function initializeStatsChannels() {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    try {
        let statsCategory = guild.channels.cache.find(
            channel => channel.name === '📊 STATISTICS' && channel.type === ChannelType.GuildCategory
        );

        if (!statsCategory) {
            statsCategory = await guild.channels.create({
                name: '📊 STATISTICS',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.Connect]
                    }
                ]
            });
        }

        const channelsConfig = [
            { name: '👥 | Customers: 0', type: ChannelType.GuildVoice, id: 'customersChannel' },
            { name: '🔑 | Active Licenses: 0', type: ChannelType.GuildVoice, id: 'activeLicensesChannel' },
            { name: '🌐 | Active Users: 0', type: ChannelType.GuildVoice, id: 'activeUsersChannel' }
        ];

        for (const channelConfig of channelsConfig) {
            let channel = guild.channels.cache.find(
                ch => ch.name.startsWith(channelConfig.name.split('|')[0]) && 
                      ch.type === ChannelType.GuildVoice &&
                      ch.parentId === statsCategory.id
            );

            if (!channel) {
                channel = await guild.channels.create({
                    name: channelConfig.name,
                    type: channelConfig.type,
                    parent: statsCategory.id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                        }
                    ]
                });
            }

            config.voiceChannels = config.voiceChannels || {};
            config.voiceChannels[channelConfig.id] = channel.id;
        }

        console.log('Statistics channels have been initialized');
        await updateStatsChannels();
    } catch (error) {
        console.error('Error during statistics channels initialization:', error);
    }
}

async function updateStatsChannels() {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild || !config.voiceChannels) return;

    try {
        const customerRole = guild.roles.cache.get(config.customerRoleId);
        const totalCustomers = customerRole ? customerRole.members.size : 0;

        const activeLicenses = await db.getActiveLicensesCount();
        const activeUsers = await db.getActiveUsersCount();

        const customersChannel = guild.channels.cache.get(config.voiceChannels.customersChannel);
        const activeLicensesChannel = guild.channels.cache.get(config.voiceChannels.activeLicensesChannel);
        const activeUsersChannel = guild.channels.cache.get(config.voiceChannels.activeUsersChannel);

        if (customersChannel) {
            await customersChannel.setName(`👥 | Customers: ${totalCustomers}`).catch(console.error);
        }
        if (activeLicensesChannel) {
            await activeLicensesChannel.setName(`🔑 | Active Licenses: ${activeLicenses.count}`).catch(console.error);
        }
        if (activeUsersChannel) {
            await activeUsersChannel.setName(`🌐 | Active Users: ${activeUsers.count}`).catch(console.error);
        }
    } catch (error) {
        console.error('Error updating statistics channels:', error);
    }
}

// =================================
//
// Bot Interactions Handling
//
// =================================
//
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
        await handleModal(interaction);
    }
});

async function handleSlashCommand(interaction) {
    const { commandName } = interaction;

    if (commandName === 'generate-license') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('generate_license_modal').setTitle('Generate a New License')
            .addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel("Duration (e.g., 1d, 7d, 1m, 1y)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('product').setLabel("Product (Private/Public/Temp/Perm)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('resets').setLabel("HWID/Discord ID Resets (* for ∞)").setStyle(TextInputStyle.Short).setRequired(true))
            );
        await interaction.showModal(modal);
    }

    if (commandName === 'license-delete') {
        if (!interaction.member.roles.cache.has(config.deleteRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('delete_license_modal').setTitle('Delete a License')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('license_key').setLabel("License key to delete").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (commandName === 'reset-discord' || commandName === 'reset-hwid') {
        const modalId = commandName === 'reset-discord' ? 'reset_discord_modal' : 'reset_hwid_modal';
        const modal = new ModalBuilder().setCustomId(modalId).setTitle(`Reset ${commandName === 'reset-discord' ? 'Discord' : 'HWID'}`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('license_key').setLabel("Enter your license key").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (commandName === 'admin-hwid') {
        if (!interaction.member.roles.cache.has(config.adminHwidResetRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('admin_hwid_modal').setTitle('ADMIN: Reset HWID')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('license_key').setLabel("Enter license key").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (commandName === 'admin-discord') {
        if (!interaction.member.roles.cache.has(config.adminDiscordResetRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('admin_discord_modal').setTitle('ADMIN: Reset Discord ID')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('license_key').setLabel("Enter license key").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (commandName === 'licenses-check') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const licenseKey = interaction.options.getString('license');
        
        if (licenseKey) {
            await showSingleLicense(interaction, licenseKey);
        } else {
            await showAllLicenses(interaction, 0, SORT_TYPES.DEFAULT);
        }
    }

    if (commandName === 'stats') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }
        await showDetailedStats(interaction);
    }

    // NEW COMMANDS
    if (commandName === 'freeze') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('freeze_modal')
            .setTitle('Freeze License');

        const licenseInput = new TextInputBuilder()
            .setCustomId('license_input')
            .setLabel("License (All/Specific license key)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const timeInput = new TextInputBuilder()
            .setCustomId('time_input')
            .setLabel("Time (e.g., 1d, 7d, 1m, 1y)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const informInput = new TextInputBuilder()
            .setCustomId('inform_input')
            .setLabel("Inform customers (Yes/No)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(licenseInput);
        const secondActionRow = new ActionRowBuilder().addComponents(timeInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(informInput);

        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
        await interaction.showModal(modal);
    }

    if (commandName === 'unfreeze') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('unfreeze_modal')
            .setTitle('Unfreeze License');

        const licenseInput = new TextInputBuilder()
            .setCustomId('license_input')
            .setLabel("License (All/Specific license key)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const informInput = new TextInputBuilder()
            .setCustomId('inform_input')
            .setLabel("Inform customers (Yes/No)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(licenseInput);
        const secondActionRow = new ActionRowBuilder().addComponents(informInput);

        modal.addComponents(firstActionRow, secondActionRow);
        await interaction.showModal(modal);
    }

    if (commandName === 'addtime') {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('addtime_modal')
            .setTitle('Add Time to License');

        const licenseInput = new TextInputBuilder()
            .setCustomId('license_input')
            .setLabel("License (All/Specific/Frozen)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const timeInput = new TextInputBuilder()
            .setCustomId('time_input')
            .setLabel("How much time (e.g., 1d, 7d, 1m, 1y)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const informInput = new TextInputBuilder()
            .setCustomId('inform_input')
            .setLabel("Inform customers (Yes/No)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(licenseInput);
        const secondActionRow = new ActionRowBuilder().addComponents(timeInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(informInput);

        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
        await interaction.showModal(modal);
    }
}

// Function to display detailed statistics
async function showDetailedStats(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const guild = client.guilds.cache.get(config.guildId);
        const customerRole = guild.roles.cache.get(config.customerRoleId);
        const totalCustomers = customerRole ? customerRole.members.size : 0;

        const activeLicenses = await db.getActiveLicensesCount();
        const activeUsers = await db.getActiveUsersCount();
        const licenseStats = await db.getLicenseStats();
        const countryStats = await db.getCountryStats();
        const resetStats = await db.getResetStats();
        const recentActivity = await db.getRecentActivity();

        // Main embed with statistics
        const mainEmbed = new EmbedBuilder()
            .setTitle('📊 DETAILED SYSTEM STATISTICS')
            .setColor('Blue')
            .setTimestamp()
            .addFields(
                {
                    name: '👥 USER STATISTICS',
                    value: `**• Customers:** ${totalCustomers}\n**• Active users:** ${activeUsers.count}\n**• Active licenses:** ${activeLicenses.count}`,
                    inline: false
                },
                {
                    name: '🔄 RESET STATISTICS',
                    value: `**• Used resets:** ${resetStats.total_resets_used || 0}\n**• Available resets:** ${resetStats.total_resets_available || 0}\n**• Usage:** ${((resetStats.total_resets_used / (resetStats.total_resets_available || 1)) * 100).toFixed(2)}%`,
                    inline: false
                }
            );

        // Embed for license statistics
        const licenseEmbed = new EmbedBuilder()
            .setTitle('📦 LICENSE STATISTICS')
            .setColor('Green')
            .setTimestamp();

        let licenseDescription = '';
        licenseStats.forEach(stat => {
            licenseDescription += `**${stat.product}:**\n`;
            licenseDescription += `• Total: ${stat.total}\n`;
            licenseDescription += `• Activated: ${stat.activated}\n`;
            licenseDescription += `• Available: ${stat.available}\n`;
            licenseDescription += `• Expired: ${stat.expired}\n\n`;
        });
        licenseEmbed.setDescription(licenseDescription);

        // Embed for country statistics
        const countryEmbed = new EmbedBuilder()
            .setTitle('🌍 COUNTRY STATISTICS')
            .setColor('Orange')
            .setTimestamp();

        let countryDescription = '';
        if (countryStats.length > 0) {
            countryStats.forEach(stat => {
                countryDescription += `**${stat.country}:** ${stat.user_count} users (${stat.percentage}%)\n`;
            });
        } else {
            countryDescription = 'No country data available';
        }
        countryEmbed.setDescription(countryDescription);

        // Embed for recent activity
        const activityEmbed = new EmbedBuilder()
            .setTitle('🕐 RECENT ACTIVITY')
            .setColor('Purple')
            .setTimestamp();

        let activityDescription = '';
        if (recentActivity.length > 0) {
            recentActivity.forEach(activity => {
                const timeAgo = `<t:${Math.floor(new Date(activity.start_time).getTime() / 1000)}:R>`;
                activityDescription += `**${activity.product}** - <@${activity.discord_id}>\n`;
                activityDescription += `• Country: ${activity.country || 'Unknown'}\n`;
                activityDescription += `• Time: ${timeAgo}\n\n`;
            });
        } else {
            activityDescription = 'No recent activity';
        }
        activityEmbed.setDescription(activityDescription);

        await interaction.editReply({ 
            embeds: [mainEmbed, licenseEmbed, countryEmbed, activityEmbed],
            ephemeral: true 
        });

    } catch (error) {
        console.error('Error fetching statistics:', error);
        await interaction.editReply({ 
            content: 'An error occurred while fetching statistics.', 
            ephemeral: true 
        });
    }
}

// Function to display all licenses with pagination
async function showAllLicenses(interaction, page = 0, sortType = SORT_TYPES.DEFAULT, isUpdate = false) {
    const licensesPerPage = 5;
    
    const allLicenses = await db.getAllLicenses();
    
    if (!allLicenses || allLicenses.length === 0) {
        if (isUpdate) {
            return interaction.editReply({ content: "No licenses in the database." });
        }
        return interaction.reply({ content: "No licenses in the database.", ephemeral: true });
    }

    let sortedLicenses;
    switch (sortType) {
        case SORT_TYPES.TEMP:
            sortedLicenses = allLicenses.sort((a, b) => {
                if (a.product === 'Temp' && b.product !== 'Temp') return -1;
                if (a.product !== 'Temp' && b.product === 'Temp') return 1;
                return 0;
            });
            break;
        case SORT_TYPES.PRIVATE:
            sortedLicenses = allLicenses.sort((a, b) => {
                if (a.product === 'Private' && b.product !== 'Private') return -1;
                if (a.product !== 'Private' && b.product === 'Private') return 1;
                return 0;
            });
            break;
        case SORT_TYPES.PUBLIC:
            sortedLicenses = allLicenses.sort((a, b) => {
                if (a.product === 'Public' && b.product !== 'Public') return -1;
                if (a.product !== 'Public' && b.product === 'Public') return 1;
                return 0;
            });
            break;
        case SORT_TYPES.PERM:
            sortedLicenses = allLicenses.sort((a, b) => {
                if (a.product === 'Perm' && b.product !== 'Perm') return -1;
                if (a.product !== 'Perm' && b.product === 'Perm') return 1;
                return 0;
            });
            break;
        default:
            const productOrder = { 'Temp': 0, 'Private': 1, 'Public': 2, 'Perm': 3 };
            sortedLicenses = allLicenses.sort((a, b) => {
                return productOrder[a.product] - productOrder[b.product];
            });
    }

    const totalPages = Math.ceil(sortedLicenses.length / licensesPerPage);
    const startIndex = page * licensesPerPage;
    const endIndex = startIndex + licensesPerPage;
    const currentLicenses = sortedLicenses.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
        .setTitle(`📋 Licenses List (Page ${page + 1}/${totalPages})`)
        .setColor('Blue')
        .setFooter({ text: `Sorting: ${SORT_DISPLAY_NAMES[sortType]}` })
        .setTimestamp();

    currentLicenses.forEach((license, index) => {
        const globalIndex = startIndex + index + 1;
        const status = (!license.linked_discord_id && !license.linked_hwid) ? 'Not used 🟢' : 'Used 🔴';
        const createdBy = license.created_by_id ? `<@${license.created_by_id}>` : license.created_by_tag;
        const createdAt = license.created_at ? `<t:${Math.floor(new Date(license.created_at).getTime() / 1000)}:F>` : 'Unknown';
        const resetsLimit = license.resets_limit === -1 ? '∞' : license.resets_limit;
        const remainingResets = license.resets_limit === -1 ? '∞' : (license.resets_limit - license.resets_used);

        embed.addFields({
            name: `**License #${globalIndex} - ${license.product}**`,
            value: `- Status: ${status}\n- Created by: ${createdBy}\n- Created at: ${createdAt}\n- Default Resets: ${resetsLimit} resets\n- Remaining Resets: ${remainingResets} resets\n- License Key: ||${license.license_key}||`,
            inline: false
        });
    });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`licenses_prev_${page}_${sortType}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`licenses_sort_${sortType}`)
                .setLabel(`Sort by: ${SORT_DISPLAY_NAMES[sortType]}`)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`licenses_next_${page}_${sortType}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === totalPages - 1)
        );

    if (isUpdate) {
        await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
}

// Function to display a single license
async function showSingleLicense(interaction, licenseKey) {
    const license = await db.getLicense(licenseKey);
    
    if (!license) {
        return interaction.reply({ content: "No license found with the provided key.", ephemeral: true });
    }

    const status = (!license.linked_discord_id && !license.linked_hwid) ? 'Not used 🟢' : 'Used 🔴';
    const createdBy = license.created_by_id ? `<@${license.created_by_id}>` : license.created_by_tag;
    const createdAt = license.created_at ? `<t:${Math.floor(new Date(license.created_at).getTime() / 1000)}:F>` : 'Unknown';
    const expiresAt = license.expires_at ? `<t:${Math.floor(new Date(license.expires_at).getTime() / 1000)}:F>` : 'Never';
    const resetsLimit = license.resets_limit === -1 ? '∞' : license.resets_limit;
    const remainingResets = license.resets_limit === -1 ? '∞' : (license.resets_limit - license.resets_used);
    const linkedDiscord = license.linked_discord_id ? `<@${license.linked_discord_id}>` : 'None';
    const lastLogin = license.last_login ? `<t:${Math.floor(new Date(license.last_login).getTime() / 1000)}:F>` : 'Never';

    const embed = new EmbedBuilder()
        .setTitle(`📋 License Details - ${license.product}`)
        .setColor(status.includes('🟢') ? 'Green' : 'Red')
        .addFields(
            { name: 'Status', value: status, inline: true },
            { name: 'Product', value: license.product, inline: true },
            { name: 'Duration', value: license.duration, inline: true },
            { name: 'Created by', value: createdBy, inline: true },
            { name: 'Created at', value: createdAt, inline: true },
            { name: 'Expires at', value: expiresAt, inline: true },
            { name: 'Linked Discord', value: linkedDiscord, inline: true },
            { name: 'Last Login', value: lastLogin, inline: true },
            { name: 'Default Resets', value: `${resetsLimit} resets`, inline: true },
            { name: 'Remaining Resets', value: `${remainingResets} resets`, inline: true },
            { name: 'Resets Used', value: `${license.resets_used}`, inline: true },
            { name: 'License Key', value: `||${license.license_key}||`, inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Handle pagination buttons
async function handleButton(interaction) {
    if (interaction.customId === 'redeem_key_button') {
        const modal = new ModalBuilder().setCustomId('redeem_key_modal').setTitle('Redeem Your Customer Role')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('license_key').setLabel("Enter your license key").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
    } 
    else if (interaction.customId.startsWith('licenses_prev_') || interaction.customId.startsWith('licenses_next_')) {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this function.", ephemeral: true });
        }

        const parts = interaction.customId.split('_');
        const action = parts[1];
        const page = parseInt(parts[2]);
        const sortType = parts[3] || SORT_TYPES.DEFAULT;

        const newPage = action === 'prev' ? page - 1 : page + 1;

        await interaction.deferUpdate();
        await showAllLicenses(interaction, newPage, sortType, true);
    }
    else if (interaction.customId.startsWith('licenses_sort_')) {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: "You don't have permission to use this function.", ephemeral: true });
        }

        const parts = interaction.customId.split('_');
        const currentSortType = parts[2] || SORT_TYPES.DEFAULT;
        
        const currentIndex = SORT_ORDER.indexOf(currentSortType);
        const nextIndex = (currentIndex + 1) % SORT_ORDER.length;
        const nextSortType = SORT_ORDER[nextIndex];

        await interaction.deferUpdate();
        await showAllLicenses(interaction, 0, nextSortType, true);
    }
}

async function handleModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const logChannel = client.channels.cache.get(config.logChannelId);

    if (interaction.customId === 'generate_license_modal') {
        const durationStr = interaction.fields.getTextInputValue('duration');
        const productInput = interaction.fields.getTextInputValue('product');
        const product = productInput.charAt(0).toUpperCase() + productInput.slice(1).toLowerCase();
        const resets = interaction.fields.getTextInputValue('resets');
        const expiresAt = product === 'Perm' ? null : parseDuration(durationStr);
        if (!expiresAt && product !== 'Perm') return interaction.editReply({ content: "Invalid duration format. Use 'd', 'm' or 'y'." });
        if (!['Private', 'Public', 'Temp', 'Perm'].includes(product)) return interaction.editReply({ content: "Invalid product. Use Private, Public, Temp, or Perm." });

        const licenseKey = `${product}-${generateRandomString(6)}-${generateRandomString(6)}-${generateRandomString(6)}`;
        const createdAt = new Date();
        const resetsLimit = resets === '*' ? -1 : parseInt(resets);
        if (isNaN(resetsLimit)) return interaction.editReply({ content: "Reset count must be a number or '*'." });

        await db.addLicense({
            key: licenseKey,
            product,
            duration: durationStr,
            createdAt,
            expiresAt,
            createdById: interaction.user.id,
            createdByTag: interaction.user.tag,
            resetsLimit
        });

        await interaction.editReply("License created successfully! You received the key in a private message!");

        const dmEmbed = new EmbedBuilder().setTitle("License Generated!").setColor("Green").setDescription(`> Date generated: <t:${Math.floor(createdAt.getTime() / 1000)}:F>\n> Product: **${product}**\n> Duration: ${expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>` : 'Permanent'}\n> HWID / Discord ID Resets: **${resets} resets**\n\n> **License Key:** ||${licenseKey}||`);
        await interaction.user.send({ embeds: [dmEmbed] }).catch(() => console.log("Cannot send DM to user."));

        if (logChannel) {
            const logEmbed = new EmbedBuilder().setTitle("License Generated!").setColor("Blue").setDescription(`> Date generated: <t:${Math.floor(createdAt.getTime() / 1000)}:F>\n> Generated by: ${interaction.user}\n> Product: **${product}**\n> Duration: ${expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>` : 'Permanent'}\n> HWID / Discord ID Resets: **${resets} resets**\n\n> **License Key:** ||${licenseKey}||`);
            await logChannel.send({ embeds: [logEmbed] });
        }
    }

    if (interaction.customId === 'redeem_key_modal') {
        const licenseKey = interaction.fields.getTextInputValue('license_key');
        const license = await db.getLicense(licenseKey);
        if (!license) return interaction.editReply({ content: "This license key does not exist." });
        if (!license.linked_discord_id) return interaction.editReply({ content: "This key must be activated first by logging into the program." });
        if (license.linked_discord_id !== interaction.user.id) return interaction.editReply({ content: "This key is assigned to a different Discord account." });
        if (license.role_redeemed) return interaction.editReply({ content: "Customer role has already been redeemed for this key." });

        try {
            const role = await interaction.guild.roles.fetch(config.customerRoleId);
            if (role) await interaction.member.roles.add(role);
            await db.updateLicense(licenseKey, { role_redeemed: 1 });
            return interaction.editReply({ content: "Successfully received the customer role!" });
        } catch (error) {
            console.error("Error assigning role:", error);
            return interaction.editReply({ content: "An error occurred while assigning the role. Contact an administrator." });
        }
    }

if (interaction.customId === 'reset_discord_modal') {
    const licenseKey = interaction.fields.getTextInputValue('license_key');
    const license = await db.getLicense(licenseKey);
    if (!license) return interaction.editReply({ content: "This license key does not exist." });
    if (license.linked_discord_id !== interaction.user.id) return interaction.editReply({ content: "You are not the owner of this key." });
    if (license.resets_limit !== -1 && license.resets_used >= license.resets_limit) return interaction.editReply({ content: "You have used all available resets." });

    const oldDiscordId = license.linked_discord_id;
    const newResetsUsed = license.resets_used + 1;
    
    // Resetowanie wszystkich pól związanych z weryfikacją
    await db.updateLicense(licenseKey, { 
        linked_discord_id: null, 
        linked_hwid: null, // Reset HWID
        verification_code: null, // Wyczyść kod weryfikacyjny
        verification_expires: null, // Wyczyść expiration kodu
        resets_used: newResetsUsed 
    });

    const remaining = license.resets_limit === -1 ? 'unlimited' : license.resets_limit - newResetsUsed;
    await sendResetLog('discord', logChannel, interaction, license, { oldDiscordId });

    return interaction.editReply(`Your linked Discord account has been unlinked. You will need to verify your Discord account again on next login. Remaining resets: \`${remaining}\``);
}

    if (interaction.customId === 'reset_hwid_modal') {
        const licenseKey = interaction.fields.getTextInputValue('license_key');
        const license = await db.getLicense(licenseKey);
        if (!license) return interaction.editReply({ content: "This license key does not exist." });
        if (license.linked_discord_id !== interaction.user.id) return interaction.editReply({ content: "You are not the owner of this key." });
        if (license.resets_limit !== -1 && license.resets_used >= license.resets_limit) return interaction.editReply({ content: "You have used all available resets." });

        const oldHwid = license.linked_hwid;
        const newResetsUsed = license.resets_used + 1;
        await db.updateLicense(licenseKey, { linked_hwid: null, resets_used: newResetsUsed });

        const remaining = license.resets_limit === -1 ? 'unlimited' : license.resets_limit - newResetsUsed;
        await sendResetLog('hwid', logChannel, interaction, license, { oldHwid });

        return interaction.editReply(`Your assigned HWID has been reset. Remaining resets: \`${remaining}\``);
    }

    if (interaction.customId === 'delete_license_modal') {
        const licenseKey = interaction.fields.getTextInputValue('license_key');
        const license = await db.getLicense(licenseKey);
        if (!license) return interaction.editReply({ content: "No key found to delete." });

        await db.deleteLicenseDB(licenseKey);

        if (logChannel) {
            const embed = new EmbedBuilder().setTitle("License Removed!").setColor("Red").setDescription(`- **License key Information:**\n> License key: ||${license.license_key}||\n> Date of deletion: <t:${Math.floor(new Date().getTime() / 1000)}:F>\n> Product: **${license.product}**\n> License Duration: ${license.duration}`);
            await logChannel.send({ embeds: [embed] });
        }

        return interaction.editReply(`Successfully deleted license: ${licenseKey}`);
    }

if (interaction.customId === 'admin_discord_modal') {
    const licenseKey = interaction.fields.getTextInputValue('license_key');
    const license = await db.getLicense(licenseKey);
    if (!license) return interaction.editReply({ content: "This license key does not exist." });

    const oldDiscordId = license.linked_discord_id;
    
    // Resetowanie wszystkich pól związanych z weryfikacją
    await db.updateLicense(licenseKey, { 
        linked_discord_id: null, 
        linked_hwid: null, // Reset HWID
        verification_code: null, // Wyczyść kod weryfikacyjny
        verification_expires: null // Wyczyść expiration kodu
    });

    await sendResetLog('discord', logChannel, interaction, license, { oldDiscordId, admin: interaction.user });
    return interaction.editReply(`Successfully reset Discord ID and HWID for key ||${licenseKey}||. User will need to verify again.`);
}

    if (interaction.customId === 'admin_hwid_modal') {
        const licenseKey = interaction.fields.getTextInputValue('license_key');
        const license = await db.getLicense(licenseKey);
        if (!license) return interaction.editReply({ content: "This license key does not exist." });

        const oldHwid = license.linked_hwid;
        await db.updateLicense(licenseKey, { linked_hwid: null });

        await sendResetLog('hwid', logChannel, interaction, license, { oldHwid, admin: interaction.user });
        return interaction.editReply(`Successfully reset HWID for key ||${licenseKey}||.`);
    }

    // NEW MODALS
    if (interaction.customId === 'freeze_modal') {
        const licenseValue = interaction.fields.getTextInputValue('license_input');
        const timeValue = interaction.fields.getTextInputValue('time_input');
        const informValue = interaction.fields.getTextInputValue('inform_input').toLowerCase();

        const freezeDuration = parseDuration(timeValue);
        if (!freezeDuration) {
            return interaction.editReply({ content: "Invalid time format. Use 'd', 'm' or 'y'." });
        }

        const frozenUntil = freezeDuration.toISOString();
        let processedLicenses = 0;
        let failedLicenses = 0;

        try {
            if (licenseValue.toLowerCase() === 'all') {
                const allLicenses = await db.getAllLicenses();
                for (const license of allLicenses) {
                    try {
                        await db.freezeLicense(license.license_key, frozenUntil, license.expires_at);
                        processedLicenses++;
                        
                        // Logging action
                        await db.logAdminAction(
                            interaction.user.id,
                            interaction.user.tag,
                            'FREEZE',
                            license.license_key,
                            `Frozen until: ${frozenUntil}, Inform customers: ${informValue}`
                        );

                        // Sending DM to user if requested
                        if (informValue === 'yes' && license.linked_discord_id) {
                            try {
                                const user = await client.users.fetch(license.linked_discord_id);
                                const embed = new EmbedBuilder()
                                    .setTitle('❄️ License Frozen')
                                    .setColor('Blue')
                                    .setDescription(`Your license **${license.license_key}** has been frozen until <t:${Math.floor(freezeDuration.getTime() / 1000)}:F>\n\nDuring this time, your license duration will not decrease.`)
                                    .setTimestamp();
                                await user.send({ embeds: [embed] });
                            } catch (dmError) {
                                console.log(`Cannot send DM to user ${license.linked_discord_id}`);
                            }
                        }
                    } catch (error) {
                        failedLicenses++;
                        console.error(`Error freezing license ${license.license_key}:`, error);
                    }
                }
            } else {
                const license = await db.getLicense(licenseValue);
                if (!license) {
                    return interaction.editReply({ content: "No license found with the provided key." });
                }

                await db.freezeLicense(license.license_key, frozenUntil, license.expires_at);
                processedLicenses++;

                // Logging action
                await db.logAdminAction(
                    interaction.user.id,
                    interaction.user.tag,
                    'FREEZE',
                    license.license_key,
                    `Frozen until: ${frozenUntil}, Inform customers: ${informValue}`
                );

                // Sending DM to user if requested
                if (informValue === 'yes' && license.linked_discord_id) {
                    try {
                        const user = await client.users.fetch(license.linked_discord_id);
                        const embed = new EmbedBuilder()
                            .setTitle('❄️ License Frozen')
                            .setColor('Blue')
                            .setDescription(`Your license **${license.license_key}** has been frozen until <t:${Math.floor(freezeDuration.getTime() / 1000)}:F>\n\nDuring this time, your license duration will not decrease.`)
                            .setTimestamp();
                        await user.send({ embeds: [embed] });
                    } catch (dmError) {
                        console.log(`Cannot send DM to user ${license.linked_discord_id}`);
                    }
                }
            }

            // Log to log channel
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('❄️ License Freeze')
                    .setColor('Blue')
                    .addFields(
                        { name: 'Admin', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Target', value: licenseValue, inline: true },
                        { name: 'Frozen Until', value: `<t:${Math.floor(freezeDuration.getTime() / 1000)}:F>`, inline: true },
                        { name: 'Processed', value: `${processedLicenses} licenses`, inline: true },
                        { name: 'Failed', value: `${failedLicenses} licenses`, inline: true },
                        { name: 'Notify Customers', value: informValue === 'yes' ? 'Yes' : 'No', inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            await interaction.editReply({ 
                content: `Successfully frozen ${processedLicenses} licenses.${failedLicenses > 0 ? ` ${failedLicenses} licenses failed to freeze.` : ''}` 
            });

        } catch (error) {
            console.error('Error in freeze modal:', error);
            await interaction.editReply({ content: "An error occurred while freezing licenses." });
        }
    }

    if (interaction.customId === 'unfreeze_modal') {
        const licenseValue = interaction.fields.getTextInputValue('license_input');
        const informValue = interaction.fields.getTextInputValue('inform_input').toLowerCase();

        let processedLicenses = 0;
        let failedLicenses = 0;

        try {
            if (licenseValue.toLowerCase() === 'all') {
                const frozenLicenses = await db.getFrozenLicenses();
                for (const license of frozenLicenses) {
                    try {
                        await db.unfreezeLicense(license.license_key);
                        processedLicenses++;

                        // Logging action
                        await db.logAdminAction(
                            interaction.user.id,
                            interaction.user.tag,
                            'UNFREEZE',
                            license.license_key,
                            `Inform customers: ${informValue}`
                        );

                        // Sending DM to user if requested
                        if (informValue === 'yes' && license.linked_discord_id) {
                            try {
                                const user = await client.users.fetch(license.linked_discord_id);
                                const embed = new EmbedBuilder()
                                    .setTitle('☀️ License Unfrozen')
                                    .setColor('Green')
                                    .setDescription(`Your license **${license.license_key}** has been unfrozen.\n\nYour license duration will now continue to decrease normally.`)
                                    .setTimestamp();
                                await user.send({ embeds: [embed] });
                            } catch (dmError) {
                                console.log(`Cannot send DM to user ${license.linked_discord_id}`);
                            }
                        }
                    } catch (error) {
                        failedLicenses++;
                        console.error(`Error unfreezing license ${license.license_key}:`, error);
                    }
                }
            } else {
                const license = await db.getLicense(licenseValue);
                if (!license) {
                    return interaction.editReply({ content: "No license found with the provided key." });
                }

                await db.unfreezeLicense(license.license_key);
                processedLicenses++;

                // Logging action
                await db.logAdminAction(
                    interaction.user.id,
                    interaction.user.tag,
                    'UNFREEZE',
                    license.license_key,
                    `Inform customers: ${informValue}`
                );

                // Sending DM to user if requested
                if (informValue === 'yes' && license.linked_discord_id) {
                    try {
                        const user = await client.users.fetch(license.linked_discord_id);
                        const embed = new EmbedBuilder()
                            .setTitle('☀️ License Unfrozen')
                            .setColor('Green')
                            .setDescription(`Your license **${license.license_key}** has been unfrozen.\n\nYour license duration will now continue to decrease normally.`)
                            .setTimestamp();
                        await user.send({ embeds: [embed] });
                    } catch (dmError) {
                        console.log(`Cannot send DM to user ${license.linked_discord_id}`);
                    }
                }
            }

            // Log to log channel
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('☀️ License Unfreeze')
                    .setColor('Green')
                    .addFields(
                        { name: 'Admin', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Target', value: licenseValue, inline: true },
                        { name: 'Processed', value: `${processedLicenses} licenses`, inline: true },
                        { name: 'Failed', value: `${failedLicenses} licenses`, inline: true },
                        { name: 'Notify Customers', value: informValue === 'yes' ? 'Yes' : 'No', inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            await interaction.editReply({ 
                content: `Successfully unfrozen ${processedLicenses} licenses.${failedLicenses > 0 ? ` ${failedLicenses} licenses failed to unfreeze.` : ''}` 
            });

        } catch (error) {
            console.error('Error in unfreeze modal:', error);
            await interaction.editReply({ content: "An error occurred while unfreezing licenses." });
        }
    }

    if (interaction.customId === 'addtime_modal') {
        const licenseValue = interaction.fields.getTextInputValue('license_input');
        const timeValue = interaction.fields.getTextInputValue('time_input');
        const informValue = interaction.fields.getTextInputValue('inform_input').toLowerCase();

        const timeToAdd = parseDuration(timeValue);
        if (!timeToAdd) {
            return interaction.editReply({ content: "Invalid time format. Use 'd', 'm' or 'y'." });
        }

        const timeToAddMs = timeToAdd.getTime() - new Date().getTime();
        let processedLicenses = 0;
        let failedLicenses = 0;

        try {
            let licensesToProcess = [];

            if (licenseValue.toLowerCase() === 'all') {
                licensesToProcess = await db.getActiveLicenses();
            } else if (licenseValue.toLowerCase() === 'freezed') {
                licensesToProcess = await db.getFrozenLicenses();
            } else {
                const license = await db.getLicense(licenseValue);
                if (!license) {
                    return interaction.editReply({ content: "No license found with the provided key." });
                }
                licensesToProcess = [license];
            }

            for (const license of licensesToProcess) {
                try {
                    await db.addTimeToLicense(license.license_key, timeToAddMs);
                    processedLicenses++;

                    // Logging action
                    await db.logAdminAction(
                        interaction.user.id,
                        interaction.user.tag,
                        'ADDTIME',
                        license.license_key,
                        `Time added: ${timeValue}, Inform customers: ${informValue}`
                    );

                    // Sending DM to user if requested
                    if (informValue === 'yes' && license.linked_discord_id) {
                        try {
                            const user = await client.users.fetch(license.linked_discord_id);
                            const embed = new EmbedBuilder()
                                .setTitle('⏰ Time Added to License')
                                .setColor('Gold')
                                .setDescription(`**${timeValue}** has been added to your license **${license.license_key}**.\n\nYour new expiration date: <t:${Math.floor((new Date(license.expires_at).getTime() + timeToAddMs) / 1000)}:F>`)
                                .setTimestamp();
                            await user.send({ embeds: [embed] });
                        } catch (dmError) {
                            console.log(`Cannot send DM to user ${license.linked_discord_id}`);
                        }
                    }
                } catch (error) {
                    failedLicenses++;
                    console.error(`Error adding time to license ${license.license_key}:`, error);
                }
            }

            // Log to log channel
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('⏰ Time Added to Licenses')
                    .setColor('Gold')
                    .addFields(
                        { name: 'Admin', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Target', value: licenseValue, inline: true },
                        { name: 'Time Added', value: timeValue, inline: true },
                        { name: 'Processed', value: `${processedLicenses} licenses`, inline: true },
                        { name: 'Failed', value: `${failedLicenses} licenses`, inline: true },
                        { name: 'Notify Customers', value: informValue === 'yes' ? 'Yes' : 'No', inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            await interaction.editReply({ 
                content: `Successfully added time to ${processedLicenses} licenses.${failedLicenses > 0 ? ` ${failedLicenses} licenses failed to update.` : ''}` 
            });

        } catch (error) {
            console.error('Error in addtime modal:', error);
            await interaction.editReply({ content: "An error occurred while adding time to licenses." });
        }
    }
}

async function sendResetLog(type, channel, interaction, license, data) {
    if (!channel) return;
    
    const ownerId = type === 'discord' ? data.oldDiscordId : license.linked_discord_id;
    let owner = null;
    let ownerMember = null;
    
    if (ownerId) {
        try {
            owner = await client.users.fetch(ownerId);
            ownerMember = await interaction.guild.members.fetch(ownerId);
        } catch (e) { }
    }

    const embed = new EmbedBuilder().setColor(type === 'hwid' ? "Orange" : "Aqua");
    const duration = license.expires_at ? `<t:${Math.floor(new Date(license.expires_at).getTime() / 1000)}:R>` : 'Permanent';

    if (type === 'hwid') {
        embed.setTitle("HWID Reset!").addFields(
            { name: "- Key Information:", value: `> License key: ||${license.license_key}||\n> Old HWID: ||${data.oldHwid || 'None'}||\n> Product: **${license.product}**\n> Duration: ${duration}\n> Key generated by: <@${license.created_by_id}>` },
            { name: "- Owner Information", value: `> Discord ID: **${ownerId || 'None'}**\n> Discord Name: **${owner ? owner.tag : 'Unknown'}**\n> Account Created: ${owner ? `<t:${Math.floor(owner.createdTimestamp / 1000)}:F>` : 'Unknown'}\n> Joined to the Server: ${ownerMember ? `<t:${Math.floor(ownerMember.joinedTimestamp / 1000)}:F>` : 'Unknown'}` }
        );
    } else {
        embed.setTitle("Discord Reset!").addFields(
            { name: "- Key Information:", value: `> License key: ||${license.license_key}||\n> HWID: ||${license.linked_hwid || 'None'}||\n> Product: **${license.product}**\n> Duration: ${duration}\n> Key generated by: <@${license.created_by_id}>`},
            { name: "- Owner Information", value: `> Old Discord ID: **${data.oldDiscordId || 'None'}**\n> Old Discord Name: **${owner ? owner.tag : 'Unknown'}**\n> Account Created: ${owner ? `<t:${Math.floor(owner.createdTimestamp / 1000)}:F>` : 'Unknown'}\n> Joined to the Server: ${ownerMember ? `<t:${Math.floor(ownerMember.joinedTimestamp / 1000)}:F>` : 'Unknown'}` }
        );
    }

    if (data.admin) {
        embed.setFooter({ text: `Reset performed by admin: ${data.admin.tag}`, iconURL: data.admin.displayAvatarURL() });
    }

    await channel.send({ embeds: [embed] });
}

// =================================
//
// API Initialization
//
// =================================
//
const app = express();
app.use(express.json());

app.post('/api/start-session', async (req, res) => {
    const { licenseKey, discordId, ipAddress } = req.body;
    
    if (!licenseKey || !discordId) {
        return res.status(400).json({ status: "error", message: "Missing required data." });
    }

    try {
        const license = await db.getLicense(licenseKey);
        if (!license) {
            return res.status(404).json({ status: "error", message: "License not found." });
        }

        // Check if license is frozen
        const now = new Date();
        if (license.frozen_until && new Date(license.frozen_until) > now) {
            // License is frozen - treat as active
        } else if (license.expires_at && new Date(license.expires_at) < now) {
            return res.status(403).json({ status: "error", message: "Your license has expired." });
        }

        await db.endUserSession(licenseKey);

        let country = 'Unknown';
        if (ipAddress && ipAddress !== '127.0.0.1') {
            country = await getCountryFromIP(ipAddress);
        }

        await db.startUserSession({
            licenseKey,
            discordId,
            ipAddress,
            country
        });

        res.json({ status: "success", message: "Session started." });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ status: "error", message: "Internal server error." });
    }
});

app.post('/api/end-session', async (req, res) => {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
        return res.status(400).json({ status: "error", message: "Missing license key." });
    }

    try {
        await db.endUserSession(licenseKey);
        res.json({ status: "success", message: "Session ended." });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ status: "error", message: "Internal server error." });
    }
});

app.post('/api/login', async (req, res) => {
    const { licenseKey, hwid } = req.body;
    if (!licenseKey || !hwid) return res.status(400).json({ status: "error", message: "Missing license key or HWID." });

    const license = await db.getLicense(licenseKey);
    if (!license) return res.status(403).json({ status: "error", message: "Invalid license key." });

    // Check if license is frozen
    const now = new Date();
    if (license.frozen_until && new Date(license.frozen_until) > now) {
        // License is frozen - treat as active
    } else if (license.expires_at && new Date(license.expires_at) < now) {
        return res.status(403).json({ status: "error", message: "Your license has expired." });
    }

    if (!license.linked_hwid) {
        return res.json({ status: "success", action: "verify_discord" });
    }

    if (license.linked_hwid !== hwid) {
        return res.status(403).json({ status: "error", message: "HWID does not match the one assigned to the key." });
    }

    await db.updateLicense(licenseKey, { last_login: new Date() });

    const user = await client.users.fetch(license.linked_discord_id).catch(() => null);
    return res.json({ status: "success", action: "login", data: { discord_name: user ? user.username : "Unknown", product: license.product } });
});

app.post('/api/request-verification', async (req, res) => {
    const { licenseKey, discordId } = req.body;
    if (!licenseKey || !discordId) return res.status(400).json({ status: "error", message: "Missing key or Discord ID." });

    const user = await client.users.fetch(discordId).catch(() => null);
    if (!user) return res.status(404).json({ status: "error", message: "No Discord user found with the provided ID." });

    const code = generateRandomString(6);
    const expires = new Date(Date.now() + 5 * 60 * 1000);
    await db.updateLicense(licenseKey, { verification_code: code, verification_expires: expires });

    try {
        await user.send(`Your verification code is: **${code}**\nThe code is valid for 5 minutes.`);
        res.json({ status: "success", message: "Verification code sent." });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Cannot send DM. Make sure you have DMs from strangers enabled." });
    }
});

app.post('/api/submit-verification', async (req, res) => {
    const { licenseKey, code, hwid, deviceInfo } = req.body;
    if (!licenseKey || !code || !hwid || !deviceInfo) return res.status(400).json({ status: "error", message: "Missing all required data." });

    const license = await db.getLicense(licenseKey);
    if (!license) return res.status(404).json({ status: "error", message: "Invalid key." });
    if (license.verification_code !== code) return res.status(403).json({ status: "error", message: "Invalid verification code." });
    if (new Date(license.verification_expires) < new Date()) return res.status(403).json({ status: "error", message: "Verification code has expired." });

    await db.updateLicense(licenseKey, {
        linked_hwid: hwid,
        linked_discord_id: deviceInfo.discordId,
        last_login: new Date(),
        verification_code: null,
        verification_expires: null
    });

    const logChannel = client.channels.cache.get(config.logChannelId);
    if (logChannel) {
        const embed = new EmbedBuilder().setTitle("First Login").setColor("Purple")
            .addFields(
                { name: "Computer Info", value: `> Device Name: **${deviceInfo.deviceName}**\n> Windows Version: **${deviceInfo.windowsVersion}**\n> HWID: ||${hwid}||`},
                { name: "License Key Information", value: `> License key: ||${license.license_key}||\n> Key created by: <@${license.created_by_id}> (${license.created_by_tag})\n> Login date: <t:${Math.floor(new Date().getTime() / 1000)}:F>\n> Key duration: ${license.expires_at ? `<t:${Math.floor(new Date(license.expires_at).getTime() / 1000)}:F>` : 'Permanent'}`}
            );
        await logChannel.send({ embeds: [embed] });
    }

    const user = await client.users.fetch(deviceInfo.discordId).catch(() => null);
    return res.json({ status: "success", action: "login", data: { discord_name: user ? user.username : "Unknown", product: license.product } });
});

client.login(config.botToken);
app.listen(config.apiPort, () => {
    console.log(`API server listening on port ${config.apiPort}`);
});