import { addGlobalContextMenuPatch, GlobalContextMenuPatchCallback, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { React, Menu } from "@webpack/common";

export function addToSubmenu(children: any[], menuId: string, menuLabel: string, newItems: any[], log?: (...args: any[]) => void) {
    let targetMenu: any = null;
    let targetList: any[] = [];
    let targetIndex: number = -1;

    const findMenu = (list: any[]) => {
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item) continue;

            const label = item.props?.label?.toString().toLowerCase().trim();
            const targetLabel = menuLabel.toLowerCase().trim();

            if (item.props?.id === menuId || label === targetLabel) {
                if (!targetMenu) {
                    targetMenu = item;
                    targetList = list;
                    targetIndex = i;
                    if (log) log(`Found target menu: ${item.props?.label} (${item.props?.id}) at index ${i}`);
                } else {
                    if (log) log(`Removing duplicate menu: ${item.props?.label} (${item.props?.id}) at index ${i}`);
                    const dupeChildren = React.Children.toArray(item.props.children);
                    const currentChildren = React.Children.toArray(targetMenu.props.children);
                    targetList[targetIndex] = React.cloneElement(targetMenu, targetMenu.props, ...currentChildren, ...dupeChildren);
                    list.splice(i, 1);
                    i--;
                }
                continue;
            }

            if (item.props?.children) {
                findMenu(React.Children.toArray(item.props.children));
            }
        }
    };

    findMenu(children);

    if (targetMenu) {
        if (log) log(`Merging into existing menu: ${targetMenu.props?.label}`);
        const oldChildren = React.Children.toArray(targetMenu.props.children);
        targetList[targetIndex] = React.cloneElement(targetMenu, { id: menuId, label: menuLabel }, ...oldChildren, ...newItems);
        return;
    }

    if (log) log(`Creating new menu ${menuId}`);
    const newMenu = (
        <Menu.MenuItem id={menuId} label={menuLabel} key={menuId}>
            {newItems}
        </Menu.MenuItem>
    );

    const lastGroup = [...children].reverse().find(c => c?.type?.displayName === "MenuGroup" || (c?.props && c.props.children));
    if (lastGroup) {
        const index = children.indexOf(lastGroup);
        const groupChildren = React.Children.toArray(lastGroup.props.children);
        groupChildren.splice(-1, 0, newMenu);
        children[index] = React.cloneElement(lastGroup, lastGroup.props, ...groupChildren);
    } else {
        children.splice(-1, 0, newMenu);
    }
}

export function registerSharedContextMenu(pluginName: string, handlers: Record<string, (children: any[], props: any) => void>, log?: (...args: any[]) => void) {
    const patch: GlobalContextMenuPatchCallback = (navId, children, ...args) => {
        const handler = handlers[navId];
        if (handler) {
            try {
                handler(children, args[0]);
            } catch (e) {
                if (log) log(`Error in context menu handler for ${navId}:`, e);
                else console.error(`[${pluginName}] Error in context menu handler for ${navId}:`, e);
            }
        }
    };
    addGlobalContextMenuPatch(patch);
    return () => removeGlobalContextMenuPatch(patch);
}
