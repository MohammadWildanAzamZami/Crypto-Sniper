// Shared runtime accessors. Keys live in the settings store (seeded from .env)
// and are read at CALL time so values entered in the Settings panel apply
// immediately, without a restart.
import { getState } from "./ai/settings.js";

export const solscanKey = () => getState().solscanKey;
export const telegram = () => getState().telegram;
