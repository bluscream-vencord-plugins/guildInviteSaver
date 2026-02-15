import type { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";

export const isVoiceChannel = (channel: Channel | null | undefined): channel is Channel =>
    channel?.type === ChannelType.GUILD_VOICE || channel?.type === ChannelType.GUILD_STAGE_VOICE;

export const isStageChannel = (channel: Channel | null | undefined): channel is Channel =>
    channel?.type === ChannelType.GUILD_STAGE_VOICE;

export const isTextChannel = (channel: Channel | null | undefined): channel is Channel =>
    channel?.type === ChannelType.GUILD_TEXT;

export const isGuildChannel = (channel: Channel | null | undefined): channel is Channel =>
    channel ? !channel.isDM() && !channel.isGroupDM() : false;
