import type { ImportedProject } from "./domain";
import { parseImportedProject } from "./project-state";

export type ProjectExample = {
  id: string;
  title: { ru: string; en: string };
  description: { ru: string; en: string };
  file: string;
};

export const PROJECT_EXAMPLES: ProjectExample[] = [
  {
    id: "right-triangle",
    title: {
      ru: "Прямоугольный треугольник 3–4–5",
      en: "3–4–5 right triangle",
    },
    description: {
      ru: "Две стороны и прямой угол. Решатель находит гипотенузу.",
      en: "Two sides and a right angle. The solver finds the hypotenuse.",
    },
    file: "examples/right-triangle.json",
  },
  {
    id: "square-area",
    title: { ru: "Площадь квадрата", en: "Area of a square" },
    description: {
      ru: "Квадрат задан стороной 6. Цель — площадь и периметр.",
      en: "A square with side 6. The targets are its area and perimeter.",
    },
    file: "examples/square-area.json",
  },
  {
    id: "major-sector",
    title: { ru: "Большой сектор", en: "Major sector" },
    description: {
      ru: "Радиус 4 и центральный угол 120°. Площадь берётся для дуги больше 180°.",
      en: "Radius 4 and a 120° central angle. Area is measured along the major arc.",
    },
    file: "examples/major-sector.json",
  },
  {
    id: "quarter-circle-perpendiculars",
    title: {
      ru: "Перпендикуляры в четверти круга",
      en: "Perpendiculars in a quarter-circle",
    },
    description: {
      ru: "Четверть круга радиуса 5, две пары точек на радиусе и дуге и связанные перпендикуляры. Нужно найти DE при FG = 4.",
      en: "A quarter-circle of radius 5, two point pairs on its radius and arc, and linked perpendiculars. Find DE when FG = 4.",
    },
    file: "examples/quarter-circle-perpendiculars.json",
  },
  {
    id: "rectangle-diagonal-angle",
    title: {
      ru: "Прямоугольник по диагонали и углу",
      en: "Rectangle from a diagonal and angle",
    },
    description: {
      ru: "Диагональ прямоугольника равна 4, а угол между диагональю и стороной — 72°. Нужно найти обе стороны.",
      en: "A rectangle has diagonal 4 and a 72° angle between the diagonal and a side. Find both side lengths.",
    },
    file: "examples/rectangle-diagonal-angle.json",
  },
  {
    id: "overturned-square",
    title: {
      ru: "Опрокинутый квадрат",
      en: "Overturned square",
    },
    description: {
      ru: "Цепочка вложенных квадратов с площадями 12, 27, 12 и 3. Нужно восстановить площадь внешнего квадрата.",
      en: "A chain of nested squares with areas 12, 27, 12 and 3. Find the area of the outer square.",
    },
    file: "examples/overturned-square.json",
  },
];

export async function loadProjectExample(
  example: ProjectExample,
): Promise<ImportedProject> {
  const response = await fetch(new URL(example.file, document.baseURI));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseImportedProject(await response.text());
}
