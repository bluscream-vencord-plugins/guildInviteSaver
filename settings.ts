import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
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
        restartNeeded: false,
    },
    messageFormat: {
        type: OptionType.STRING,
        description: "Message format template (Variables: {now}, {guildName}, {guildId}, {inviteList})",
        default: "[{now}] Left Guild \"{guildName}\" ({guildId}):\n{inviteList}",
        placeholder: "[{now}] Left Guild \"{guildName}\" ({guildId}):\n{inviteList}",
        restartNeeded: false,
    },
    messageTemplateReference: {
        type: OptionType.STRING,
        description: "Template preview (Calculated field)",
        default: "{now} {guildName} {guildId} {inviteList}",
        placeholder: "{now} {guildName} {guildId} {inviteList}",
        readonly: true,
        restartNeeded: false,
        onChange(newVal) {
            settings.store.messageTemplateReference = settings.def.messageTemplateReference.default;
        },
    },
});
