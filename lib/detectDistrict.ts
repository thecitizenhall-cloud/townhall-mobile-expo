// Detect a resident's election district from their location — entirely on the
// device. The lat/lon are used only for local point-in-polygon; they are NEVER
// sent to the server (same privacy posture as the ZK verifier). We fetch the
// public district polygons once (district_boundaries RPC, ~50KB) and test locally.
// Mirror of the web lib/detectDistrict.js.
import { supabase } from "./supabase";

type Geom = { type: string; coordinates: any };
type District = { id: string; slug: string; name: string; geom: Geom };

let _cache: District[] | null = null;

async function getDistricts(): Promise<District[]> {
  if (_cache) return _cache;
  const { data, error } = await supabase.rpc("district_boundaries");
  if (error || !data) return [];
  _cache = (data as any[]).map(d => ({ id: d.id, slug: d.slug, name: d.name, geom: JSON.parse(d.geojson) }));
  return _cache;
}

// Ray-casting point-in-ring. ring = [[lon,lat], …]; x=lon, y=lat.
function ringContains(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function polyContains(coords: number[][][], x: number, y: number): boolean {
  if (!coords.length || !ringContains(coords[0], x, y)) return false;
  for (let k = 1; k < coords.length; k++) if (ringContains(coords[k], x, y)) return false; // inside a hole
  return true;
}
function geomContains(geom: Geom, x: number, y: number): boolean {
  if (geom.type === "Polygon") return polyContains(geom.coordinates, x, y);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p: number[][][]) => polyContains(p, x, y));
  return false;
}

// → { id, slug, name } of the containing district, or null. Location stays local.
export async function detectDistrict(lat: number, lon: number): Promise<{ id: string; slug: string; name: string } | null> {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const districts = await getDistricts();
  for (const d of districts) if (geomContains(d.geom, lon, lat)) return { id: d.id, slug: d.slug, name: d.name };
  return null;
}
