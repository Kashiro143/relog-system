export type Role = "master" | "forge" | "overlay" | "player";

export interface Permissions {
  can_change_mode: boolean;
  can_use_soundboard: boolean;
  can_glitch: boolean;
  can_edit_stats: boolean;
  can_control_obs: boolean;
  [key: string]: boolean | undefined;
}

export interface Actor {
  id: string;
  name: string;
  color: string;
  currentMode: string;
  status: "online" | "offline";
  permissions: Permissions;
}

export interface ModuleDefinition {
  id: string;
  label: string;
  overlayUrl: string;
  playerUrl: string;
}
