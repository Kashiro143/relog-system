import type { ObsClient } from "./obsClient";
import { appUrl } from "../appUrl";

// Ce que le K-OS sait installer dans OBS pour un membre, et comment le
// retrouver : une source navigateur est "à nous" si son URL pointe vers
// overlay.html / module.html avec ?u=<membre>, quel que soit son nom (ex. une
// source créée à la main avant l'installateur).

export type Part = "relog" | "module";

export const PART_INFO: Record<Part, { name: string; page: string; label: string; hint: string }> = {
  relog: {
    name: "K-OS · Re:log",
    page: "overlay.html",
    label: "Re:log",
    hint: "GIF, salons, signaux et watch-party envoyés par les autres",
  },
  module: {
    name: "K-OS · Module",
    page: "module.html",
    label: "Module",
    hint: "Ton module du moment (ex. équipe PokeMMO)",
  },
};

export const WATCH_SCENE = "K-OS · Watch-party";

export interface SceneState {
  name: string;
  /** main : scène qu'on affiche ; nested : utilisée comme source dans une autre scène ; separator : ligne "=====" de rangement. */
  kind: "main" | "nested" | "separator";
  /** Élément de scène déjà présent pour chaque partie. */
  items: Partial<Record<Part, { sourceName: string; sceneItemId: number }>>;
}

export interface ObsState {
  canvas: { w: number; h: number };
  scenes: SceneState[];
  /** Sources navigateur existantes pour chaque partie (nom → URL). */
  inputs: Record<Part, { name: string; url: string }[]>;
}

export type Plan = Record<string, Record<Part, boolean>>;

/** Retrouve la partie K-OS d'une URL de source navigateur, pour ce membre. */
export function partOfUrl(url: string, actorId: string): Part | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.searchParams.get("u") !== actorId) return null;
  const file = u.pathname.split("/").pop();
  if (file === PART_INFO.relog.page) return "relog";
  if (file === PART_INFO.module.page) return "module";
  return null;
}

export function canonicalUrl(part: Part, actorId: string, moduleSeparate: boolean): string {
  const base = `${appUrl(PART_INFO[part].page)}?u=${encodeURIComponent(actorId)}`;
  return part === "relog" && moduleSeparate ? `${base}&module=0` : base;
}

/**
 * URL corrigée d'une source existante : on garde son adresse (site en ligne ou
 * local) et on n'ajuste que ?module=0. null si rien à changer.
 */
export function retargetUrl(url: string, part: Part, moduleSeparate: boolean): string | null {
  if (part !== "relog") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const has = u.searchParams.get("module") === "0";
  if (has === moduleSeparate) return null;
  if (moduleSeparate) u.searchParams.set("module", "0");
  else u.searchParams.delete("module");
  return u.href;
}

export async function readState(obs: ObsClient, actorId: string): Promise<ObsState> {
  const video = await obs.request("GetVideoSettings");
  const { inputs } = await obs.request<{ inputs: { inputName: string }[] }>("GetInputList", { inputKind: "browser_source" });
  const found: ObsState["inputs"] = { relog: [], module: [] };
  const partByInput = new Map<string, Part>();
  for (const i of inputs) {
    const { inputSettings } = await obs.request("GetInputSettings", { inputName: i.inputName });
    const part = partOfUrl(String(inputSettings?.url ?? ""), actorId);
    if (!part) continue;
    found[part].push({ name: i.inputName, url: inputSettings.url });
    partByInput.set(i.inputName, part);
  }
  const { scenes } = await obs.request<{ scenes: { sceneName: string; sceneIndex: number }[] }>("GetSceneList");
  // GetSceneList renvoie les scènes de bas en haut de la liste OBS.
  const ordered = [...scenes].sort((a, b) => b.sceneIndex - a.sceneIndex);
  const out: SceneState[] = [];
  const nested = new Set<string>();
  for (const s of ordered) {
    const { sceneItems } = await obs.request<{ sceneItems: { sourceName: string; sceneItemId: number; sourceType?: string }[] }>("GetSceneItemList", { sceneName: s.sceneName });
    const items: SceneState["items"] = {};
    for (const it of sceneItems) {
      if (it.sourceType === "OBS_SOURCE_TYPE_SCENE") nested.add(it.sourceName);
      const part = partByInput.get(it.sourceName);
      if (part && !items[part]) items[part] = { sourceName: it.sourceName, sceneItemId: it.sceneItemId };
    }
    out.push({ name: s.sceneName, kind: "main", items });
  }
  for (const s of out) {
    if (/^[\s=\-_~*#.|]+$/.test(s.name)) s.kind = "separator";
    else if (nested.has(s.name)) s.kind = "nested";
  }
  return { canvas: { w: video.baseWidth, h: video.baseHeight }, scenes: out, inputs: found };
}

/**
 * Plan proposé par défaut, pour que rien ne change à l'écran : Re:log et
 * module là où ils sont déjà visibles (un ancien Re:log sans ?module=0 affiche
 * aussi le module). Première installation : les deux partout.
 */
export function defaultPlan(state: ObsState): Plan {
  const plan: Plan = {};
  const anyRelog = state.scenes.some((s) => s.items.relog);
  // Sources Re:log sans ?module=0 : elles affichent aussi le module.
  const relogShowsModule = new Set(state.inputs.relog.filter((i) => !retargetUrl(i.url, "relog", false)).map((i) => i.name));
  for (const s of state.scenes) {
    const relog = s.items.relog;
    plan[s.name] = {
      relog: anyRelog || s.kind !== "main" ? !!relog : true,
      module: anyRelog || s.kind !== "main" ? !!s.items.module || (!!relog && relogShowsModule.has(relog.sourceName)) : true,
    };
  }
  return plan;
}

export interface ApplyResult {
  added: number;
  removed: number;
  updated: number;
  created: string[];
}

export async function applyPlan(
  obs: ObsClient,
  actorId: string,
  state: ObsState,
  plan: Plan,
  opts: { createWatchScene: boolean; onStep?: (text: string) => void },
): Promise<ApplyResult> {
  const res: ApplyResult = { added: 0, removed: 0, updated: 0, created: [] };
  const step = opts.onStep ?? (() => {});
  const scenes = state.scenes.map((s) => ({ ...s, items: { ...s.items } }));

  if (opts.createWatchScene && !scenes.some((s) => s.name === WATCH_SCENE)) {
    step(`Création de la scène « ${WATCH_SCENE} »…`);
    await obs.request("CreateScene", { sceneName: WATCH_SCENE });
    res.created.push(WATCH_SCENE);
    scenes.unshift({ name: WATCH_SCENE, kind: "main", items: {} });
    plan[WATCH_SCENE] = { relog: true, module: false };
  }

  // Le module a toujours sa propre source : il n'apparaît que là où il est coché.
  const moduleSeparate = true;
  const inputName: Record<Part, string | null> = {
    relog: state.inputs.relog[0]?.name ?? null,
    module: state.inputs.module[0]?.name ?? null,
  };

  // Les URL des sources existantes sont remises à jour (ex. Re:log sans le
  // module quand le module a sa propre source, et inversement).
  for (const part of ["relog", "module"] as Part[]) {
    for (const i of state.inputs[part]) {
      const target = retargetUrl(i.url, part, moduleSeparate);
      if (!target) continue;
      step(`Mise à jour de « ${i.name} »…`);
      await obs.request("SetInputSettings", { inputName: i.name, inputSettings: { url: target }, overlay: true });
      res.updated++;
    }
  }

  const place = async (sceneName: string, sceneItemId: number) => {
    await obs.request("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX: 0,
        positionY: 0,
        alignment: 5,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsAlignment: 0,
        boundsWidth: state.canvas.w,
        boundsHeight: state.canvas.h,
      },
    });
  };

  // Module d'abord, Re:log ensuite : chaque ajout passe au-dessus, donc
  // Re:log (GIF, vidéos) reste par-dessus le module.
  for (const part of ["module", "relog"] as Part[]) {
    for (const s of scenes) {
      const want = !!plan[s.name]?.[part];
      const has = s.items[part];
      if (want && !has) {
        step(`Ajout de ${PART_INFO[part].label} dans « ${s.name} »…`);
        let id: number;
        const existing = inputName[part];
        if (existing) {
          ({ sceneItemId: id } = await obs.request("CreateSceneItem", { sceneName: s.name, sourceName: existing }));
        } else {
          ({ sceneItemId: id } = await obs.request("CreateInput", {
            sceneName: s.name,
            inputName: PART_INFO[part].name,
            inputKind: "browser_source",
            inputSettings: {
              url: canonicalUrl(part, actorId, moduleSeparate),
              width: 1920,
              height: 1080,
              // Le son des vidéos passe dans le mixeur d'OBS.
              reroute_audio: part === "relog",
            },
            sceneItemEnabled: true,
          }));
          inputName[part] = PART_INFO[part].name;
        }
        await place(s.name, id);
        res.added++;
      } else if (!want && has) {
        // On retire seulement l'élément de cette scène : la source reste dans OBS.
        step(`Retrait de ${PART_INFO[part].label} de « ${s.name} »…`);
        await obs.request("RemoveSceneItem", { sceneName: s.name, sceneItemId: has.sceneItemId });
        res.removed++;
      }
    }
  }
  return res;
}
