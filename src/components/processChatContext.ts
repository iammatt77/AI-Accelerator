"use client";

import { createContext } from "react";

// A viewer (ProcessMapViewer) adja a bezáró callbacket a slotként kapott
// chat-drawernek. Context kell: a slot-elem szerver-komponensben készül,
// így függvény-propot a viewer nem tud ráklónozni (RSC-határ).
export const ProcessChatCloseContext = createContext<(() => void) | null>(null);
