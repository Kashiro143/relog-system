import { Kernel } from "../kernel";

const container = document.getElementById("module-container") as HTMLIFrameElement;
new Kernel("overlay", { container });
