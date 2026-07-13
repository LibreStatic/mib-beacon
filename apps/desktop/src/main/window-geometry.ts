export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function centered(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

export function getVisibleWindowBounds(bounds: Rectangle, workAreas: Rectangle[]): Rectangle {
  const first = workAreas[0];
  if (!first) return bounds;
  const target = workAreas.find((workArea) => intersects(bounds, workArea));
  if (!target) return centered(bounds, first);

  const width = Math.min(bounds.width, target.width);
  const height = Math.min(bounds.height, target.height);
  return {
    x: Math.max(target.x, Math.min(bounds.x, target.x + target.width - width)),
    y: Math.max(target.y, Math.min(bounds.y, target.y + target.height - height)),
    width,
    height,
  };
}

export function getNextWindowBounds(focused: Rectangle, workArea: Rectangle): Rectangle {
  const candidate = { ...focused, x: focused.x + 28, y: focused.y + 28 };
  if (
    candidate.x + candidate.width <= workArea.x + workArea.width &&
    candidate.y + candidate.height <= workArea.y + workArea.height
  ) {
    return candidate;
  }
  return centered(focused, workArea);
}
