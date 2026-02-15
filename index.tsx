// Authors: Bluscream, Cursor.AI
// Created at 2025-12-20 14:33:15
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { registerSharedContextMenu } from "./utils/menus";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, GuildChannelStore, GuildStore, Menu, MessageStore, RestAPI, showToast, Toasts } from "@webpack/common";
import { isTextChannel } from "./utils/channels";
import { sendMessage } from "@utils/discord";

import { Logger } from "@utils/Logger";

const pluginId = "guildInviteSaver";
const pluginName = "Guild Invite Saver";
const logger = new Logger(pluginName, "#7289da");

const settings = definePluginSettings({
    autoBackupOnLeave: {
        type: OptionType.BOOLEAN,
        description: "Automatically backup invites when leaving a guild",
        default: true,
        restartNeeded: false,
    },
    targetGroupDmId: {
        type: OptionType.STRING,
        description: "Group DM ID to send invite links to",
        placeholder: "1092812198537089126",
        default: "1092812198537089126",
    },
    messageFormat: {
        type: OptionType.STRING,
        description: "Message format template. Variables: {now}=current timestamp, {guildName}=guild name, {guildId}=guild ID, {inviteList}=formatted list of invite links",
        default: "[{now}] Left Guild \"{guildName}\" ({guildId}):\n{inviteList}",
        placeholder: "[{now}] Left Guild \"{guildName}\" ({guildId}):\n{inviteList}",
        restartNeeded: false,
    },
    messageTemplateReference: {
        type: OptionType.STRING,
        description: "Template Reference - Variables: {now}=current timestamp, {guildName}=guild name, {guildId}=guild ID, {inviteList}=formatted list of invite links",
        default: "{now} {guildName} {guildId} {inviteList}",
        placeholder: "{now} {guildName} {guildId} {inviteList}",
        readonly: true,
        restartNeeded: false,
        onChange(newVal: string) {
            settings.store.messageTemplateReference = settings.def.messageTemplateReference.default;
        },
    },
});

// Regex to match Discord invite links
const INVITE_REGEX = /discord\.(?:gg|com\/invite)\/([a-zA-Z0-9]+)/gi;

/**
 * Extract invite codes from text
 */
function extractInviteCodes(text: string): string[] {
    const codes: string[] = [];
    const matches = text.matchAll(INVITE_REGEX);
    for (const match of matches) {
        if (match[1]) {
            codes.push(match[1]);
        }
    }
    return codes;
}

/**
 * Get full invite link from code
 */
function getInviteLink(code: string): string {
    return `https://discord.gg/${code}`;
}

/**
 * Collect invites from a guild before leaving
 */
async function collectGuildInvites(guildId: string): Promise<string[]> {
    const invites = new Set<string>();
    const guild = GuildStore.getGuild(guildId);

    if (!guild) {
        logger.warn(`Guild ${guildId} not found`);
        return [];
    }

    logger.info(`Collecting invites for guild: ${guild.name} (${guildId})`);

    // Get channels first (needed for both invite creation and message searching)
    const channels = GuildChannelStore.getChannels(guildId);
    logger.debug(`Retrieved channels object for guild ${guildId}:`, channels ? Object.keys(channels) : "null");

    if (!channels) {
        logger.warn(`No channels found for guild ${guildId}`);
        // Still check for vanity URL even if no channels
        if (guild.vanityURLCode) {
            invites.add(guild.vanityURLCode);
            logger.info(`Found vanity URL: ${guild.vanityURLCode}`);
        }
        return Array.from(invites);
    }

    // GuildChannelStore.getChannels returns an object that can have different structures:
    // - TEXT property with array of {channel: Channel} objects
    // - Numeric keys (like '4') representing channel types with arrays
    // - Direct channel objects
    let textChannels: any[] = [];

    // Try TEXT property first (standard structure)
    if ((channels as any).TEXT && Array.isArray((channels as any).TEXT)) {
        logger.debug(`Found TEXT array with ${(channels as any).TEXT.length} items`);
        // Extract the channel from each item in the TEXT array
        textChannels = (channels as any).TEXT
            .map((item: any) => item.channel || item)
            .filter((channel: any) => isTextChannel(channel)); // GUILD_TEXT
        logger.debug(`Extracted ${textChannels.length} text channels after filtering`);
    } else {
        // Collect all arrays from the channels object and filter for text channels
        // The structure might have numeric keys (like '4') that are arrays of channels
        // or other properties that contain arrays
        const allChannelArrays: any[] = [];

        for (const key of Object.keys(channels)) {
            // Skip non-array properties like 'id', 'count', 'SELECTABLE', 'VOCAL'
            if (key === 'id' || key === 'count' || key === 'SELECTABLE' || key === 'VOCAL') {
                continue;
            }

            const value = (channels as any)[key];
            if (Array.isArray(value)) {
                logger.debug(`Found array at key '${key}' with ${value.length} items`);
                allChannelArrays.push(...value);
            } else if (value && typeof value === 'object' && !value.id && !value.type && !value.count) {
                // Might be nested object with arrays
                const nested = Object.values(value);
                if (nested.some((v: any) => Array.isArray(v))) {
                    nested.forEach((v: any) => {
                        if (Array.isArray(v)) {
                            logger.debug(`Found nested array with ${v.length} items`);
                            allChannelArrays.push(...v);
                        }
                    });
                }
            }
        }

        logger.debug(`Collected ${allChannelArrays.length} items from all arrays`);
        textChannels = allChannelArrays
            .map((item: any) => item.channel || item)
            .filter((channel: any) => isTextChannel(channel)); // GUILD_TEXT
        logger.debug(`Extracted ${textChannels.length} text channels`);
    }

    // 1. Try to generate an infinite invite using RestAPI
    // We need a channel ID to create an invite, so use the first text channel
    if (textChannels.length > 0) {
        try {
            // Use the first text channel to create the invite
            const channelId = textChannels[0].id;
            const channelName = textChannels[0].name || "unknown";
            logger.debug(`Attempting to create invite for channel ${channelName} (${channelId})`);

            try {
                // Discord API endpoint: POST /channels/{channel.id}/invites
                const response = await RestAPI.post({
                    url: `/channels/${channelId}/invites`,
                    body: {
                        max_age: 0, // Never expires
                        max_uses: 0, // Unlimited uses
                        temporary: false
                    },
                    retries: 1
                });

                logger.debug(`Invite creation response status: ${response.status}, ok: ${response.ok}`);

                if (response.ok && response.body && response.body.code) {
                    invites.add(response.body.code);
                    logger.info(`Generated invite: ${response.body.code}`);
                } else {
                    logger.warn(`Invite creation failed - response not ok or missing code. Status: ${response.status}, Body:`, response.body);
                }
            } catch (error) {
                logger.error(`Failed to create invite for ${guild.name} in channel ${channelName}:`, error);
                if (error instanceof Error) {
                    logger.error(`Error details: ${error.message}`, error.stack);
                }
            }
        } catch (error) {
            logger.error(`Failed to prepare invite creation for ${guild.name}:`, error);
            if (error instanceof Error) {
                logger.error(`Error details: ${error.message}`, error.stack);
            }
        }
    } else {
        logger.debug(`Skipping invite creation - no text channels available`);
    }

    // 2. Look for vanity URL (perm invite in guild props)
    if (guild.vanityURLCode) {
        invites.add(guild.vanityURLCode);
        logger.info(`Found vanity URL: ${guild.vanityURLCode}`);
    } else {
        logger.debug(`No vanity URL found for guild ${guild.name}`);
    }

    // 3. Look through messages in text channels

    logger.info(`Searching ${textChannels.length} text channels for invites`);

    // Search through each text channel
    for (const channel of textChannels) {
        const channelName = channel.name || "unknown";
        const channelId = channel.id;
        logger.debug(`Processing channel: ${channelName} (${channelId})`);

        try {
            // Fetch most recent messages from API (last batch)
            // Using limit 100 (Discord's max per request) to get as many as possible
            try {
                logger.debug(`Fetching recent messages from channel ${channelName}`);
                const recentResponse = await RestAPI.get({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    query: {
                        limit: 100 // Most recent messages (Discord's max)
                    },
                    retries: 1
                });

                logger.debug(`Recent messages response for ${channelName}: status=${recentResponse.status}, ok=${recentResponse.ok}, messages=${recentResponse.body?.length || 0}`);

                if (recentResponse.ok && recentResponse.body && Array.isArray(recentResponse.body)) {
                    let foundInRecent = 0;
                    for (const message of recentResponse.body) {
                        if (message.content) {
                            const codes = extractInviteCodes(message.content);
                            const beforeCount = invites.size;
                            codes.forEach(code => invites.add(code));
                            if (invites.size > beforeCount) {
                                foundInRecent += invites.size - beforeCount;
                            }
                        }
                    }
                    if (foundInRecent > 0) {
                        logger.debug(`Found ${foundInRecent} invite(s) in recent messages from ${channelName}`);
                    }
                } else {
                    logger.warn(`Invalid response format for recent messages from ${channelName}:`, {
                        ok: recentResponse.ok,
                        hasBody: !!recentResponse.body,
                        isArray: Array.isArray(recentResponse.body)
                    });
                }
            } catch (error) {
                logger.error(`Failed to fetch recent messages from channel ${channelName}:`, error);
                if (error instanceof Error) {
                    logger.error(`Error details: ${error.message}`, error.stack);
                }
            }

            // Fetch oldest messages (first batch) using after with a very early message ID
            // Discord's epoch is 2015-01-01, we use message ID "0" or calculate an early snowflake
            try {
                logger.debug(`Fetching oldest messages from channel ${channelName} using after:0`);
                const oldestResponse = await RestAPI.get({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    query: {
                        limit: 100, // Fetch as many as possible
                        after: "0" // Try to get messages after message ID 0 (earliest possible)
                    },
                    retries: 1
                });

                logger.debug(`Oldest messages response for ${channelName}: status=${oldestResponse.status}, ok=${oldestResponse.ok}, messages=${oldestResponse.body?.length || 0}`);

                if (oldestResponse.ok && oldestResponse.body && Array.isArray(oldestResponse.body)) {
                    let foundInOldest = 0;
                    // If we got messages, they should be the oldest ones
                    for (const message of oldestResponse.body) {
                        if (message.content) {
                            const codes = extractInviteCodes(message.content);
                            const beforeCount = invites.size;
                            codes.forEach(code => invites.add(code));
                            if (invites.size > beforeCount) {
                                foundInOldest += invites.size - beforeCount;
                            }
                        }
                    }
                    if (foundInOldest > 0) {
                        logger.debug(`Found ${foundInOldest} invite(s) in oldest messages from ${channelName}`);
                    }
                } else {
                    logger.debug(`'after:0' method failed for ${channelName}, trying fallback`);
                }
            } catch (error) {
                logger.debug(`'after:0' method failed for ${channelName}, trying fallback:`, error);
                // If 'after: 0' doesn't work, try fetching with just limit (which gets newest)
                // and then use the oldest message ID to fetch older ones
                try {
                    logger.debug(`Fetching fallback messages from channel ${channelName}`);
                    const fallbackResponse = await RestAPI.get({
                        url: Constants.Endpoints.MESSAGES(channelId),
                        query: {
                            limit: 100
                        },
                        retries: 1
                    });

                    logger.debug(`Fallback response for ${channelName}: status=${fallbackResponse.status}, ok=${fallbackResponse.ok}, messages=${fallbackResponse.body?.length || 0}`);

                    if (fallbackResponse.ok && fallbackResponse.body && Array.isArray(fallbackResponse.body) && fallbackResponse.body.length > 0) {
                        const oldestMessageId = fallbackResponse.body[fallbackResponse.body.length - 1]?.id;
                        logger.debug(`Oldest message ID from fallback: ${oldestMessageId}`);

                        if (oldestMessageId) {
                            try {
                                logger.debug(`Fetching messages before ${oldestMessageId} from channel ${channelName}`);
                                const beforeResponse = await RestAPI.get({
                                    url: Constants.Endpoints.MESSAGES(channelId),
                                    query: {
                                        limit: 100,
                                        before: oldestMessageId
                                    },
                                    retries: 1
                                });

                                logger.debug(`Before response for ${channelName}: status=${beforeResponse.status}, ok=${beforeResponse.ok}, messages=${beforeResponse.body?.length || 0}`);

                                if (beforeResponse.ok && beforeResponse.body && Array.isArray(beforeResponse.body)) {
                                    let foundInBefore = 0;
                                    for (const message of beforeResponse.body) {
                                        if (message.content) {
                                            const codes = extractInviteCodes(message.content);
                                            const beforeCount = invites.size;
                                            codes.forEach(code => invites.add(code));
                                            if (invites.size > beforeCount) {
                                                foundInBefore += invites.size - beforeCount;
                                            }
                                        }
                                    }
                                    if (foundInBefore > 0) {
                                        logger.debug(`Found ${foundInBefore} invite(s) in before messages from ${channelName}`);
                                    }
                                }
                            } catch (innerError) {
                                logger.debug(`Failed to fetch messages before ${oldestMessageId} from ${channelName}:`, innerError);
                            }
                        }
                    }
                } catch (fallbackError) {
                    logger.debug(`Fallback method failed for ${channelName}:`, fallbackError);
                }
            }
        } catch (error) {
            logger.error(`Error processing channel ${channelName}:`, error);
            if (error instanceof Error) {
                logger.error(`Error details: ${error.message}`, error.stack);
            }
        }
    }

    logger.info(`Found ${invites.size} unique invite codes`);
    return Array.from(invites);
}

/**
 * Send invites to the group DM
 */
async function sendInvitesToGroupDM(guildId: string, guildName: string, inviteCodes: string[]): Promise<void> {
    if (inviteCodes.length === 0) {
        logger.info("No invites to send");
        return;
    }

    const targetGroupDmId = settings.store.targetGroupDmId;
    logger.debug(`Target Group DM ID: ${targetGroupDmId}`);

    if (!targetGroupDmId) {
        logger.error("Target Group DM ID not configured");
        return;
    }

    try {
        const channel = ChannelStore.getChannel(targetGroupDmId);
        if (!channel) {
            logger.error(`Group DM ${targetGroupDmId} not found in ChannelStore`);
            return;
        }

        logger.debug(`Found target channel: ${channel.name || "unnamed"} (${targetGroupDmId})`);

        const now = new Date().toISOString();
        const inviteLinks = inviteCodes.map(code => `- ${getInviteLink(code)}`).join("\n");

        // Format message using template
        const message = settings.store.messageFormat
            .replace(/{now}/g, now)
            .replace(/{guildName}/g, guildName)
            .replace(/{guildId}/g, guildId)
            .replace(/{inviteList}/g, inviteLinks);

        logger.debug(`Sending message to group DM (length: ${message.length} chars)`);
        logger.debug(`Message content preview: ${message.substring(0, 200)}...`);

        await sendMessage(targetGroupDmId, {
            content: message
        });

        logger.info(`Successfully sent ${inviteCodes.length} invites to group DM ${targetGroupDmId}`);
    } catch (error) {
        logger.error("Failed to send invites to group DM:", error);
        if (error instanceof Error) {
            logger.error(`Error details: ${error.message}`, error.stack);
        }
    }
}

/**
 * Backup invites for a guild (can be called manually or automatically)
 */
async function backupGuildInvites(guildId: string, isManual = false): Promise<void> {
    logger.debug(`backupGuildInvites called: guildId=${guildId}, isManual=${isManual}`);

    try {
        const guild = GuildStore.getGuild(guildId);
        if (!guild) {
            logger.warn(`Guild ${guildId} not found in GuildStore`);
            if (isManual) {
                showToast("Guild not found", Toasts.Type.FAILURE);
            }
            return;
        }

        logger.info(`${isManual ? "Manually" : "Automatically"} backing up invites for guild: ${guild.name} (${guildId})`);

        if (isManual) {
            showToast(`Backing up invites for ${guild.name}...`, Toasts.Type.MESSAGE);
        }

        // Collect all invites
        logger.debug(`Starting invite collection for guild ${guild.name}`);
        const inviteCodes = await collectGuildInvites(guildId);
        logger.debug(`Collected ${inviteCodes.length} invite codes:`, inviteCodes);

        if (inviteCodes.length === 0) {
            if (isManual) {
                showToast("No invites found to backup", Toasts.Type.FAILURE);
            }
            logger.info("No invites found to backup");
            return;
        }

        // Send to group DM
        logger.debug(`Sending ${inviteCodes.length} invites to group DM`);
        await sendInvitesToGroupDM(guildId, guild.name, inviteCodes);

        if (isManual) {
            showToast(`Successfully backed up ${inviteCodes.length} invite(s)`, Toasts.Type.SUCCESS);
        }

        logger.info(`Backup completed successfully for guild ${guild.name}`);
    } catch (error) {
        logger.error("Error in backupGuildInvites:", error);
        if (error instanceof Error) {
            logger.error(`Error details: ${error.message}`, error.stack);
        }
        if (isManual) {
            showToast("Failed to backup invites", Toasts.Type.FAILURE);
        }
    }
}

/**
 * Intercept guild leave and collect invites (if enabled)
 */
async function onGuildLeave(guildId: string) {
    logger.debug(`onGuildLeave called for guild: ${guildId}`);
    logger.debug(`autoBackupOnLeave setting: ${settings.store.autoBackupOnLeave}`);

    // Only backup automatically if the setting is enabled
    if (!settings.store.autoBackupOnLeave) {
        logger.debug("Auto backup is disabled, skipping");
        return;
    }

    logger.info(`Intercepting leave for guild: ${guildId}`);
    await backupGuildInvites(guildId, false);
}

/**
 * Context menu patch for guild context menu
 */
const GuildContextMenu: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!guild) {
        logger.debug("GuildContextMenu: No guild provided");
        return;
    }

    logger.debug(`GuildContextMenu: Adding menu item for guild ${guild.name} (${guild.id})`);

    children.push(
        <Menu.MenuItem
            id="backup-guild-invites"
            label="Backup Invite"
            action={() => {
                logger.debug(`Manual backup triggered from context menu for guild ${guild.name}`);
                backupGuildInvites(guild.id, true);
            }}
        />
    );
};

export default definePlugin({
    name: "GuildInviteSaver",
    description: "Automatically collects and saves invite links before leaving a guild",
    authors: [
        { name: "Bluscream", id: 467777925790564352n },
        { name: "Cursor.AI", id: 0n },
    ],
    settings,

    patches: [
        {
            find: "async leaveGuild(",
            replacement: {
                match: /(async leaveGuild\((\i)\){)/,
                replace: "$1await $self.onGuildLeave($2);"
            }
        }
    ],


    stopCleanup: null as (() => void) | null,
    start() {
        this.stopCleanup = registerSharedContextMenu("GuildInviteSaver", {
            "guild-context": (children, props) => {
                if (props.guild) GuildContextMenu(children, props);
            }
        });
    },
    stop() {
        this.stopCleanup?.();
    },
    onGuildLeave
});
