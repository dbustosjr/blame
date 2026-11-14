import { cssVariables } from "@blame-ai/design-tokens";
import type { CSSProperties } from "react";

/**
 * DESIGN.md tokens as CSS custom properties on <html>. globals.css maps them into the Tailwind
 * theme and the shadcn variables, so the site never defines its own color values.
 */
export const tokenStyle = cssVariables() as CSSProperties;
