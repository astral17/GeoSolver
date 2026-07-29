import type {
  ExpressionRow,
  MathNode,
  ParsedConstraint,
  Shape,
} from "./domain";

export function buildEqualSideMarks(
  parsedKnown: (ExpressionRow & { parsed: ParsedConstraint | null })[],
  shapes: Shape[],
) {
    const sideKey = (ids: string[]) =>
      ids.length === 2 ? [...ids].sort().join("|") : null;
    const distanceSide = (node: MathNode) =>
      node.kind === "measure" && node.measure === "distance"
        ? sideKey(node.ids)
        : null;
    const drawableSides = new Map<string, [string, string]>();
    const visibleObjectGroups = new Map<string, Set<string>>();
    const indexVisibleGroup = (group: Set<string>) => {
      const ids = [...group];
      for (let first = 0; first < ids.length; first += 1) {
        for (let second = first + 1; second < ids.length; second += 1) {
          const pair = [ids[first], ids[second]] as [string, string];
          const key = sideKey(pair);
          if (!key) continue;
          visibleObjectGroups.set(key, group);
          drawableSides.set(key, pair);
        }
      }
    };
    const registerVisibleObject = (ids: [string, string]) => {
      const key = sideKey(ids);
      if (!key) return;
      const group = visibleObjectGroups.get(key) ?? new Set<string>();
      ids.forEach((id) => group.add(id));
      indexVisibleGroup(group);
    };

    shapes.forEach((shape) => {
      if (
        (shape.type === "segment" ||
          shape.type === "line" ||
          shape.type === "ray") &&
        shape.points.length >= 2
      ) {
        registerVisibleObject([shape.points[0], shape.points[1]]);
      }
      if (
        (shape.type === "polygon" || shape.type === "polyline") &&
        shape.points.length >= (shape.type === "polygon" ? 3 : 2)
      ) {
        shape.points
          .slice(0, shape.type === "polygon" ? undefined : -1)
          .forEach((id, index) => {
            registerVisibleObject([
              id,
              shape.points[(index + 1) % shape.points.length],
            ]);
          });
      }
      if (shape.type === "sector" && shape.points.length >= 3) {
        registerVisibleObject([shape.points[0], shape.points[1]]);
        registerVisibleObject([shape.points[0], shape.points[2]]);
      }
    });

    const memberships = parsedKnown
      .map(({ parsed }) => parsed)
      .filter(
        (parsed): parsed is ParsedConstraint =>
          parsed?.kind === "onSegment" ||
          parsed?.kind === "onLine" ||
          parsed?.kind === "onRay",
      );
    let expanded = true;
    for (
      let pass = 0;
      expanded && pass <= memberships.length;
      pass += 1
    ) {
      expanded = false;
      memberships.forEach((membership) => {
        const baseKey = sideKey(membership.ids.slice(1, 3));
        const group = baseKey ? visibleObjectGroups.get(baseKey) : null;
        const pointId = membership.ids[0];
        if (!group || group.has(pointId)) return;
        group.add(pointId);
        indexVisibleGroup(group);
        expanded = true;
      });
    }

    const parent = new Map<string, string>();
    const find = (key: string): string => {
      const current = parent.get(key);
      if (!current) {
        parent.set(key, key);
        return key;
      }
      if (current === key) return key;
      const root = find(current);
      parent.set(key, root);
      return root;
    };
    const unite = (first: string, second: string) => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    };

    parsedKnown.forEach(({ parsed }) => {
      if (parsed?.kind !== "formula" || !parsed.formula) return;
      (parsed.formulas ?? [parsed.formula]).forEach((equation) => {
        const left = distanceSide(equation.left);
        const right = distanceSide(equation.right);
        if (left && right) unite(left, right);
      });
    });

    const groups = new Map<string, string[]>();
    parent.forEach((_, key) => {
      if (!drawableSides.has(key)) return;
      const root = find(key);
      const group = groups.get(root) ?? [];
      if (!group.includes(key)) group.push(key);
      groups.set(root, group);
    });

    return [...groups.values()]
      .filter((group) => group.length >= 2)
      .map((group) => group.sort())
      .sort((first, second) => first.join().localeCompare(second.join()))
      .flatMap((group, index) =>
        group.map((key) => ({
          ids: drawableSides.get(key) as [string, string],
          count: index + 1,
        })),
      );
}
