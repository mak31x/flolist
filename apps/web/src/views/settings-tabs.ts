/** Settings tabs (settings-and-account.md; Developer arrives with M9). */
export const settingsTabs = [
  { id: "profile", label: "Profile" },
  { id: "features", label: "Features" },
  { id: "workspaces", label: "Workspaces" },
  { id: "integrations", label: "Integrations" },
  { id: "notifications", label: "Notifications" },
  { id: "labels", label: "Labels" },
  { id: "collaborators", label: "Collaborators" },
] as const;

export type SettingsTab = (typeof settingsTabs)[number]["id"];

export function isSettingsTab(value: string): value is SettingsTab {
  return settingsTabs.some((t) => t.id === value);
}
