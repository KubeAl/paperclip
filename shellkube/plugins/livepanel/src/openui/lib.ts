import { openuiLibrary } from "@openuidev/react-ui";

// Shared by the frame (renders) and build.mjs (writes the parser schema for the worker).
// CodeBlock is dropped: its syntax highlighter is a quarter of the bundle and panels do not need it.
export const lib = openuiLibrary.extend!({ components: { remove: ["CodeBlock"] } });
