//// Plugin originally written for Equicord at 2026-02-16 by https://github.com/Bluscream, https://antigravity.google
// region Imports
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import {
    ChannelStore,
    Constants,
    GuildChannelStore,
    GuildStore,
    Menu,
    MessageStore,
    RestAPI,
    showToast,
    Toasts
} from "@webpack/common";

import { isTextChannel } from "./utils/channels";
import { registerSharedContextMenu } from "./utils/menus";
import { settings } from "./settings";
// endregion Imports

// region PluginInfo
export const pluginInfo = {
    id: "guildInviteSaver",
    name: "GuildInviteSaver",
    description: "Automatically collects and saves invite links before leaving a server",
    color: "#7289da",
    authors: [
        { name: "Bluscream", id: 467777925790564352n },
        { name: "Assistant", id: 0n }
    ],
};
// endregion PluginInfo

// region Variables
const logger = new Logger(pluginInfo.id, pluginInfo.color);
const INVITE_REGEX = /discord\.(?:gg|com\/invite)\/([a-zA-Z0-9]+)/gi;
// endregion Variables

// region Utils
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

function getInviteLink(code: string): string {
    return `https://discord.gg/${code}`;
}

async function collectGuildInvites(guildId: string): Promise<string[]> {
    const invites = new Set<string>();
    const guild = GuildStore.getGuild(guildId);

    if (!guild) {
        logger.warn(`Guild ${guildId} not found`);
        return [];
    }

    logger.info(`Collecting invites for guild: ${guild.name} (${guildId})`);

    const channels = GuildChannelStore.getChannels(guildId);
    if (!channels) {
        logger.warn(`No channels found for guild ${guildId}`);
        if (guild.vanityURLCode) {
            invites.add(guild.vanityURLCode);
        }
        return Array.from(invites);
    }

    let textChannels: any[] = [];
    if ((channels as any).TEXT && Array.isArray((channels as any).TEXT)) {
        textChannels = (channels as any).TEXT
            .map((item: any) => item.channel || item)
            .filter((channel: any) => isTextChannel(channel));
    } else {
        const allChannelArrays: any[] = [];
        for (const key of Object.keys(channels)) {
            if (['id', 'count', 'SELECTABLE', 'VOCAL'].includes(key)) continue;
            const value = (channels as any)[key];
            if (Array.isArray(value)) {
                allChannelArrays.push(...value);
            }
        }
        textChannels = allChannelArrays
            .map((item: any) => item.channel || item)
            .filter((channel: any) => isTextChannel(channel));
    }

    if (textChannels.length > 0) {
        try {
            const channelId = textChannels[0].id;
            const response = await RestAPI.post({
                url: `/channels/${channelId}/invites`,
                body: { max_age: 0, max_uses: 0, temporary: false },
                retries: 1
            });

            if (response.ok && response.body && response.body.code) {
                invites.add(response.body.code);
            }
        } catch (error) {
            logger.error(`Failed to create invite for ${guild.name}:`, error);
        }
    }

    if (guild.vanityURLCode) {
        invites.add(guild.vanityURLCode);
    }

    for (const channel of textChannels) {
        const channelId = channel.id;
        try {
            const recentResponse = await RestAPI.get({
                url: Constants.Endpoints.MESSAGES(channelId),
                query: { limit: 100 },
                retries: 1
            });

            if (recentResponse.ok && recentResponse.body && Array.isArray(recentResponse.body)) {
                for (const message of recentResponse.body) {
                    if (message.content) {
                        extractInviteCodes(message.content).forEach(code => invites.add(code));
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing channel ${channel.name}:`, error);
        }
    }

    return Array.from(invites);
}

async function sendInvitesToGroupDM(guildId: string, guildName: string, inviteCodes: string[]): Promise<void> {
    if (inviteCodes.length === 0) return;

    const targetGroupDmId = settings.store.targetGroupDmId;
    if (!targetGroupDmId) {
        logger.error("Target Group DM ID not configured");
        return;
    }

    try {
        const channel = ChannelStore.getChannel(targetGroupDmId);
        if (!channel) {
            logger.error(`Group DM ${targetGroupDmId} not found`);
            return;
        }

        const now = new Date().toISOString();
        const inviteLinks = inviteCodes.map(code => `- ${getInviteLink(code)}`).join("\n");

        const message = settings.store.messageFormat
            .replace(/{now}/g, now)
            .replace(/{guildName}/g, guildName)
            .replace(/{guildId}/g, guildId)
            .replace(/{inviteList}/g, inviteLinks);

        await sendMessage(targetGroupDmId, { content: message });
    } catch (error) {
        logger.error("Failed to send invites to group DM:", error);
    }
}

async function backupGuildInvites(guildId: string, isManual = false): Promise<void> {
    try {
        const guild = GuildStore.getGuild(guildId);
        if (!guild) return;

        if (isManual) showToast(`Backing up invites for ${guild.name}...`, Toasts.Type.MESSAGE);

        const inviteCodes = await collectGuildInvites(guildId);
        if (inviteCodes.length === 0) {
            if (isManual) showToast("No invites found to backup", Toasts.Type.FAILURE);
            return;
        }

        await sendInvitesToGroupDM(guildId, guild.name, inviteCodes);
        if (isManual) showToast(`Successfully backed up ${inviteCodes.length} invite(s)`, Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Error in backupGuildInvites:", error);
        if (isManual) showToast("Failed to backup invites", Toasts.Type.FAILURE);
    }
}

async function onGuildLeave(guildId: string) {
    if (!settings.store.autoBackupOnLeave) return;
    await backupGuildInvites(guildId, false);
}
// endregion Utils

// region Main
const GuildContextMenu: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!guild) return;

    children.push(
        <Menu.MenuItem
            id="backup-guild-invites"
            label="Backup Invite"
            action={() => backupGuildInvites(guild.id, true)}
        />
    );
};
// endregion Main

// region Definition
export default definePlugin({
    name: pluginInfo.name,
    description: pluginInfo.description,
    authors: pluginInfo.authors,
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
        this.stopCleanup = registerSharedContextMenu(pluginInfo.id, {
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
// endregion Definition
