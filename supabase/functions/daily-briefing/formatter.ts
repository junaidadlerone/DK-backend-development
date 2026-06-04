// Notion block builder helpers.
// All functions return plain objects ready to be passed to the Notion Blocks API.

type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  }>;
};

export function rt(
  content: string,
  opts: { bold?: boolean; italic?: boolean; color?: string } = {},
): RichText {
  return {
    type: "text",
    text: { content },
    annotations: {
      bold:   opts.bold   ?? false,
      italic: opts.italic ?? false,
      color:  opts.color  ?? "default",
    },
  };
}

export function h2(text: string): object {
  return {
    type: "heading_2",
    heading_2: { rich_text: [rt(text)], is_toggleable: false },
  };
}

export function h3(text: string): object {
  return {
    type: "heading_3",
    heading_3: { rich_text: [rt(text)], is_toggleable: false },
  };
}

export function callout(text: string, emoji: string, color = "blue_background"): object {
  return {
    type: "callout",
    callout: {
      rich_text: [rt(text)],
      icon: { type: "emoji", emoji },
      color,
    },
  };
}

/** Bullet with optional bold prefix and gray suffix. */
export function bullet(
  text: string,
  opts: { boldPrefix?: string; graySuffix?: string } = {},
): object {
  const parts: RichText[] = [];
  if (opts.boldPrefix) parts.push(rt(opts.boldPrefix + " ", { bold: true }));
  parts.push(rt(text));
  if (opts.graySuffix) parts.push(rt("  " + opts.graySuffix, { color: "gray" }));
  return { type: "bulleted_list_item", bulleted_list_item: { rich_text: parts } };
}

export function divider(): object {
  return { type: "divider", divider: {} };
}

/** h3 heading + bulleted list items built by formatFn on each element. */
export function renderSection<T>(
  heading: string,
  items: T[],
  formatFn: (item: T) => object,
): object[] {
  if (!items.length) return [];
  return [h3(heading), ...items.map(formatFn)];
}

/** Format a task for a per-person bullet: "Title [Status] · Priority" */
export function taskBullet(title: string, status: string, priority: string): object {
  return {
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt(title, { bold: true }),
        rt(`  [${status}]`, { color: "gray" }),
        rt(`  · ${priority}`, { color: "gray" }),
      ],
    },
  };
}

/** Format a delta bullet: "Title: From → To" */
export function deltaBullet(title: string, from: string, to: string, owner: string | null): object {
  return {
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt(title, { bold: true }),
        rt(`:  ${from} → ${to}`, { color: "gray" }),
        ...(owner ? [rt(`  (${owner})`, { color: "gray", italic: true })] : []),
      ],
    },
  };
}
