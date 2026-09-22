let frToEn: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

async function loadPokedex(): Promise<Record<string, string>> {
  const res = await fetch("https://raw.githubusercontent.com/fanzeyi/Pokemon-DB/master/pokedex.json");
  const data: Array<{ name?: { french?: string; english?: string } }> = await res.json();

  const map: Record<string, string> = {};
  for (const p of data) {
    if (p.name?.french && p.name?.english) {
      map[p.name.french.toLowerCase()] = p.name.english.toLowerCase().replace(" ", "-").replace(".", "");
    }
  }
  // Correctifs manuels pour les cas où PokeAPI est strict sur le nom anglais.
  map["grotadmorv"] = "muk";
  map["roucool"] = "pidgey";
  map["m. mime"] = "mr-mime";
  return map;
}

export async function ensurePokedexLoaded(): Promise<Record<string, string>> {
  if (frToEn) return frToEn;
  loading ??= loadPokedex();
  frToEn = await loading;
  return frToEn;
}

export interface PokeApiResult {
  id: number;
}

/** Cherche un Pokémon par nom (français ou anglais) via PokeAPI. Lève une erreur si introuvable. */
export async function searchPokemonByName(name: string): Promise<PokeApiResult> {
  const dex = await ensurePokedexLoaded();
  const frName = name.toLowerCase().trim();
  const apiName = dex[frName] || frName;

  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${apiName}`);
  if (!res.ok) throw new Error(`Pokémon "${name}" introuvable.`);
  return res.json();
}

export function animatedSpriteUrl(pokemonId: number): string {
  if (!pokemonId) return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${pokemonId}.gif`;
}

export function staticSpriteUrl(pokemonId: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId || 0}.png`;
}
