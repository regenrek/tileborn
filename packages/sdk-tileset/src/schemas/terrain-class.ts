import { Schema } from "effect";

/** Semantic terrain label used by autotile and transition rules. */
export const TerrainClass = Schema.String.pipe(Schema.brand("TerrainClass"));
export type TerrainClass = typeof TerrainClass.Type;
