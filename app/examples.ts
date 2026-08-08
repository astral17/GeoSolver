import type { ImportedProject } from "./domain";
import { parseImportedProject } from "./project-state";

export type ProjectExample = {
  id: string;
  title: { ru: string; en: string };
  description: { ru: string; en: string };
  file: string;
  category?: ProjectExampleCategoryId;
};

export type ProjectExampleCategoryId =
  | "basics"
  | "triangles"
  | "circles"
  | "polygons"
  | "equations"
  | "challenges";

export const PROJECT_EXAMPLE_CATEGORIES: {
  id: ProjectExampleCategoryId;
  title: { ru: string; en: string };
}[] = [
  { id: "basics", title: { ru: "Основы", en: "Basics" } },
  { id: "triangles", title: { ru: "Треугольники", en: "Triangles" } },
  { id: "circles", title: { ru: "Окружности", en: "Circles" } },
  { id: "polygons", title: { ru: "Многоугольники", en: "Polygons" } },
  { id: "equations", title: { ru: "Уравнения", en: "Equations" } },
  { id: "challenges", title: { ru: "Сложные", en: "Challenges" } },
];

const EXAMPLE_CATEGORY_IDS: Partial<
  Record<ProjectExampleCategoryId, Set<string>>
> = {
  triangles: new Set([
    "triangle-altitudes-24", "equilateral-circle-26",
    "one-fact", "isosceles-everywhere", "t1-angle-sum",
    "isosceles-altitude", "median-area-t2", "inconsistent-altitude-t3",
    "right-triangle-altitude-t4", "similar-triangles-t8",
    "scalene-triangle-t9", "task-t", "t17", "t13", "t11",
    "all-born-equal", "beautiful-haircut",
  ]),
  circles: new Set([
    "quarter-circle-perpendiculars", "tangent-circles-25",
    "green-vs-blue", "semicircle-turducken", "two-circles-tale",
    "intersecting-sectors-t5", "orthogonal-circle-t6", "t18", "t16",
    "t14", "power-chords",
  ]),
  polygons: new Set([
    "rectangle-diagonal-angle", "overturned-square", "doc-oct",
    "all-in-square", "isosceles-trapezoid-t10", "runaway-polygon", "t12",
    "this-is-a-trap", "sunset-square-city",
  ]),
  equations: new Set(["cardioid", "apollo"]),
  challenges: new Set([
    "washing-machine", "exterior-angle-t7", "t15", "t19",
  ]),
};

export function projectExampleCategory(
  example: ProjectExample,
): ProjectExampleCategoryId {
  if (example.category) return example.category;
  return (
    PROJECT_EXAMPLE_CATEGORIES.find((category) =>
      EXAMPLE_CATEGORY_IDS[category.id]?.has(example.id),
    )?.id ?? "basics"
  );
}

export const PROJECT_EXAMPLES: ProjectExample[] = [
  {
    id: "cardioid",
    title: { ru: "Кардиоида", en: "Cardioid" },
    description: {
      ru: "Неявная кривая с параметром a = 1 демонстрирует уравнения, локальные координаты x, y и точную отрисовку особенности в начале координат.",
      en: "An implicit curve with a = 1 demonstrates equations, local x/y coordinates, and cusp rendering at the origin.",
    },
    file: "examples/cardioid.json",
  },
  {
    id: "apollo",
    title: { ru: "Аполлон", en: "Apollo" },
    description: {
      ru: "Область f1 задана неравенством расстояний и совпадает с эллипсом CAD. Решатель проверяет, что разность их площадей равна нулю.",
      en: "Region f1 is defined by a distance inequality and coincides with ellipse CAD. The solver verifies that their area difference is zero.",
    },
    file: "examples/apollo.json",
  },
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
  {
    id: "doc-oct",
    title: {
      ru: "Doc Oct — правильный восьмиугольник",
      en: "Doc Oct — regular octagon",
    },
    description: {
      ru: "Правильный восьмиугольник, в котором площадь самопересекающегося ABED равна периметру. Нужно найти обе величины.",
      en: "A regular octagon whose self-intersecting ABED area equals its perimeter. Find both values.",
    },
    file: "examples/doc-oct.json",
  },
  {
    id: "tangent-circles-25",
    title: {
      ru: "25 — касающиеся окружности",
      en: "25 — tangent circles",
    },
    description: {
      ru: "Три попарно касающиеся окружности радиусов 9, 6 и 3 и их общая хорда-касательная. Нужно найти длину NQ.",
      en: "Three pairwise tangent circles with radii 9, 6 and 3 and their common tangent chord. Find NQ.",
    },
    file: "examples/tangent-circles-25.json",
  },
  {
    id: "triangle-altitudes-24",
    title: {
      ru: "24 — высоты и касательная",
      en: "24 — altitudes and a tangent",
    },
    description: {
      ru: "Окружность с центром в ортоцентре и секущая с отношением 1:5. Аналитический ответ: BC = 3, r = 1.",
      en: "A circle centred at the orthocentre and a 1:5 secant. Analytical result: BC = 3 and r = 1.",
    },
    file: "examples/triangle-altitudes-24.json",
  },
  {
    id: "equilateral-circle-26",
    title: {
      ru: "26 — два равносторонних треугольника",
      en: "26 — two equilateral triangles",
    },
    description: {
      ru: "Два различных равносторонних треугольника по разные стороны общей стороны и точка на окружности. Координатное раскрытие даёт точный инвариант 0.",
      en: "Two distinct equilateral triangles on opposite sides of their common side and a point on a circle. A coordinate expansion gives the exact invariant 0.",
    },
    file: "examples/equilateral-circle-26.json",
  },
  {
    id: "green-vs-blue",
    title: {
      ru: "Зелёный против синего",
      en: "Green versus blue",
    },
    description: {
      ru: "Первые две суммы площадей зависят от положения квадратов, но их разность неизменно равна площади заданного треугольника: 5.",
      en: "The first two area sums vary with the construction, but their difference is the fixed triangle area: 5.",
    },
    file: "examples/green-vs-blue.json",
  },
  {
    id: "semicircle-turducken",
    title: {
      ru: "Полукруг-турдакен",
      en: "Semicircle turducken",
    },
    description: {
      ru: "Прямоугольный треугольник в полуокружности и его вписанная окружность. Искомый угол равен 45°.",
      en: "A right triangle in a semicircle and its incircle. The requested angle is 45°.",
    },
    file: "examples/semicircle-turducken.json",
  },
  {
    id: "two-circles-tale",
    title: {
      ru: "Сказка о двух кругах",
      en: "A tale of two circles",
    },
    description: {
      ru: "Вписанные окружности равностороннего треугольника и правильного шестиугольника равного периметра. Отношения площадей: 4/9 и 9/4.",
      en: "Incircle areas of an equilateral triangle and a regular hexagon with equal perimeters: 4/9 and 9/4.",
    },
    file: "examples/two-circles-tale.json",
  },
  {
    id: "washing-machine",
    title: {
      ru: "Стиральная машина",
      en: "Washing machine",
    },
    description: {
      ru: "Цепочка четырёх равных квадратов во вписанной окружности. Отношение их суммарной площади к внешнему квадрату равно 2/5.",
      en: "A chain of four equal squares in an inscribed circle. Their total-area ratio to the outer square is 2/5.",
    },
    file: "examples/washing-machine.json",
  },
  {
    id: "one-fact",
    title: {
      ru: "Только один факт",
      en: "Only one fact",
    },
    description: {
      ru: "Середина хорды и высота сегмента FH = 1 определяют сторону внешнего квадрата 4 и его площадь 16.",
      en: "A chord midpoint and segment height FH = 1 determine the outer-square side 4 and its area 16.",
    },
    file: "examples/one-fact.json",
  },
  {
    id: "all-in-square",
    title: {
      ru: "Всё в квадрате",
      en: "All in a square",
    },
    description: {
      ru: "Вписанный повёрнутый квадрат и окружность, касающаяся двух сторон внешнего квадрата и стороны внутреннего. Без условия вложенности возможны площади 4π и 144π.",
      en: "A rotated inscribed square and a circle tangent to two outer sides and one inner side. Without containment, the possible areas are 4π and 144π.",
    },
    file: "examples/all-in-square.json",
  },
  {
    id: "isosceles-everywhere",
    title: {
      ru: "Я видел равнобедренных",
      en: "Isosceles triangles everywhere",
    },
    description: {
      ru: "Цепочка равнобедренных треугольников, точка на отрезке и четыре точки одной окружности. Общие правила углов дают ∠EFD = 108°.",
      en: "A chain of isosceles triangles, a point on a segment, and four concyclic points. General angle rules give ∠EFD = 108°.",
    },
    file: "examples/isosceles-everywhere.json",
  },
  {
    id: "t1-angle-sum",
    title: {
      ru: "Сумма длин и углы",
      en: "Length sum and angles",
    },
    description: {
      ru: "В треугольнике с точкой на стороне известны два угла и условие AD + AC = BC. Теорема синусов даёт точный ответ ∠CBA = 40°.",
      en: "A point on a triangle side, two known angles, and AD + AC = BC. The sine law gives the exact result ∠CBA = 40°.",
    },
    file: "examples/t1-angle-sum.json",
  },
  {
    id: "isosceles-altitude",
    title: {
      ru: "Высота равнобедренного",
      en: "Isosceles-triangle altitude",
    },
    description: {
      ru: "Равенство углов при основании доказывает равенство боковых сторон. Высота к основанию является медианой, поэтому AH = 7.",
      en: "Equal base angles imply equal sides. The altitude to the base is also a median, so AH = 7.",
    },
    file: "examples/isosceles-altitude.json",
  },
  {
    id: "median-area-t2",
    title: {
      ru: "Медиана и площадь",
      en: "Median and area",
    },
    description: {
      ru: "По сторонам AB = 6, BC = 8 и медиане BD = 5 теорема Аполлония даёт AC = 10, после чего площадь равна 24.",
      en: "From AB = 6, BC = 8, and median BD = 5, Apollonius's theorem gives AC = 10 and the area is 24.",
    },
    file: "examples/median-area-t2.json",
  },
  {
    id: "inconsistent-altitude-t3",
    title: {
      ru: "Невозможная высота",
      en: "Impossible altitude",
    },
    description: {
      ru: "Высота к гипотенузе длины 10 не может быть равна 6. Численный решатель должен показать ближайшее, а не объявить систему решённой.",
      en: "An altitude to a hypotenuse of length 10 cannot equal 6. The numerical solver must show the nearest result instead of accepting the system.",
    },
    file: "examples/inconsistent-altitude-t3.json",
  },
  {
    id: "right-triangle-altitude-t4",
    title: {
      ru: "Высота к гипотенузе",
      en: "Altitude to the hypotenuse",
    },
    description: {
      ru: "В прямоугольном треугольнике 5–12–13 теорема о проекциях катетов даёт AD = 25/13 и CD = 144/13.",
      en: "In a 5–12–13 right triangle, the leg-projection theorem gives AD = 25/13 and CD = 144/13.",
    },
    file: "examples/right-triangle-altitude-t4.json",
  },
  {
    id: "intersecting-sectors-t5",
    title: {
      ru: "Пересечение секторов",
      en: "Intersecting sectors",
    },
    description: {
      ru: "Две пересекающиеся полуокружности на общей прямой. Теорема Стюарта и теорема косинусов дают ∠CGD = 45°.",
      en: "Two intersecting semicircles on one baseline. Stewart's theorem and the law of cosines give ∠CGD = 45°.",
    },
    file: "examples/intersecting-sectors-t5.json",
  },
  {
    id: "orthogonal-circle-t6",
    title: {
      ru: "Ортогональная ломаная в окружности",
      en: "Orthogonal chain in a circle",
    },
    description: {
      ru: "Длины звеньев дают две ортогональные компоненты хорд. По трём хордам формула R = abc/(4S) даёт AB = sqrt(34)/2.",
      en: "The link lengths give two orthogonal chord components. From the three chords, R = abc/(4S) gives AB = sqrt(34)/2.",
    },
    file: "examples/orthogonal-circle-t6.json",
  },
  {
    id: "exterior-angle-t7",
    title: { ru: "Внешний угол треугольника", en: "Exterior triangle angle" },
    description: {
      ru: "Смежные углы и сумма углов прямоугольного треугольника дают ∠BCD = 130° независимо от выбранной единицы ввода углов.",
      en: "Supplementary angles and the right-triangle angle sum give ∠BCD = 130° independently of the selected input angle unit.",
    },
    file: "examples/exterior-angle-t7.json",
  },
  {
    id: "similar-triangles-t8",
    title: { ru: "Подобные треугольники на сторонах", en: "Nested similar triangles" },
    description: {
      ru: "Подобие по двум углам даёт BM/BA = MN/AC = 2/5, поэтому AM = 25 − 10 = 15.",
      en: "AA similarity gives BM/BA = MN/AC = 2/5, hence AM = 25 − 10 = 15.",
    },
    file: "examples/similar-triangles-t8.json",
  },
  {
    id: "scalene-triangle-t9",
    title: { ru: "Треугольник по трём сторонам", en: "Triangle from three sides" },
    description: {
      ru: "Теорема косинусов находит точные отношения −1/4, 7/8 и 11/16. Нетабличные углы сохраняются как выражения через acos без десятичного округления.",
      en: "The law of cosines gives the exact ratios −1/4, 7/8, and 11/16. Non-tabular angles remain exact acos expressions without decimal rounding.",
    },
    file: "examples/scalene-triangle-t9.json",
  },
  {
    id: "isosceles-trapezoid-t10",
    title: {
      ru: "Равнобедренная трапеция с диагональю",
      en: "Isosceles trapezoid with a diagonal",
    },
    description: {
      ru: "Равные боковые стороны, параллельные основания и перпендикулярная стороне диагональ дают углы 60° и 120°.",
      en: "Equal legs, parallel bases, and a diagonal perpendicular to a side give the angles 60° and 120°.",
    },
    file: "examples/isosceles-trapezoid-t10.json",
  },
  {
    id: "task-t",
    title: { ru: "Две связанные биссектрисы", en: "Two linked bisectors" },
    description: { ru: "Угловые равенства и три заданные длины определяют CD.", en: "Angle equalities and three fixed lengths determine CD." },
    file: "examples/task-t.json",
  },
  {
    id: "t18",
    title: { ru: "Окружность и равносторонний треугольник", en: "Circle and equilateral triangle" },
    description: { ru: "Симметричная хорда и равносторонний треугольник; найдите разность длин.", en: "A symmetric chord and an equilateral triangle; find the length difference." },
    file: "examples/t18.json",
  },
  {
    id: "t17",
    title: { ru: "Произведение сторон", en: "Product of sides" },
    description: { ru: "Циклическая конфигурация сводится к степенному соотношению.", en: "A cyclic configuration reduces to a power relation." },
    file: "examples/t17.json",
  },
  {
    id: "t16",
    title: { ru: "Четыре точки на окружности", en: "Four concyclic points" },
    description: { ru: "Сумма двух вписанных углов в непересекающейся конфигурации.", en: "A sum of two inscribed angles in a non-crossing configuration." },
    file: "examples/t16.json",
  },
  {
    id: "t15",
    title: { ru: "Параллельное сечение треугольника", en: "Parallel triangle section" },
    description: { ru: "Пересечения секущих и параллельная сторона дают две тождественные разности.", en: "Transversal intersections and a parallel side give two invariant differences." },
    file: "examples/t15.json",
  },
  {
    id: "t14",
    title: { ru: "Три равные хорды", en: "Three equal chords" },
    description: { ru: "Площадь равностороннего вписанного треугольника сравнивается с площадью круга.", en: "Compare an inscribed equilateral triangle with its circle." },
    file: "examples/t14.json",
  },
  {
    id: "t13",
    title: { ru: "Треугольник 30°–45°", en: "30°–45° triangle" },
    description: { ru: "Точная площадь по стороне и двум углам.", en: "Exact area from one side and two angles." },
    file: "examples/t13.json",
  },
  {
    id: "runaway-polygon",
    title: { ru: "Уехалиугольник", en: "Runaway polygon" },
    description: { ru: "Большая система выпуклости, равенств и отношений площадей.", en: "A large system of convexity, equalities, and area ratios." },
    file: "examples/runaway-polygon.json",
  },
  {
    id: "t12",
    title: { ru: "Прямоугольник по площади и отношению", en: "Rectangle from area and ratio" },
    description: { ru: "Стороны прямоугольника находятся точно из отношения 4:9 и площади 144.", en: "Find rectangle sides exactly from ratio 4:9 and area 144." },
    file: "examples/t12.json",
  },
  {
    id: "t11",
    title: { ru: "Треугольник 40°–60°–80°", en: "40°–60°–80° triangle" },
    description: { ru: "Теорема синусов для двух неизвестных сторон.", en: "Use the sine rule for two unknown sides." },
    file: "examples/t11.json",
  },
  {
    id: "this-is-a-trap",
    title: { ru: "Это ловушка", en: "This is a trap" },
    description: { ru: "Площади частей трапеции и прямой угол определяют основание.", en: "Areas within a trapezoid and a right angle determine a base." },
    file: "examples/this-is-a-trap.json",
  },
  {
    id: "power-chords",
    title: { ru: "Степенные хорды", en: "Power chords" },
    description: { ru: "Многоступенчатая конфигурация окружностей, хорд и касательных.", en: "A multi-stage configuration of circles, chords, and tangencies." },
    file: "examples/power-chords.json",
  },
  {
    id: "all-born-equal",
    title: { ru: "Все рождены равными", en: "All born equal" },
    description: { ru: "Равные отрезки и площади в связанной системе треугольников.", en: "Equal segments and areas in a linked triangle system." },
    file: "examples/all-born-equal.json",
  },
  {
    id: "beautiful-haircut",
    title: { ru: "Красивая стрижка", en: "Beautiful haircut" },
    description: { ru: "Сложное разбиение треугольника с целевой площадью.", en: "A complex triangle subdivision with a target area." },
    file: "examples/beautiful-haircut.json",
  },
  {
    id: "sunset-square-city",
    title: { ru: "Закат над Квадратным городом", en: "Sunset over Square City" },
    description: { ru: "Цепочка квадратов и пересечений с точной площадью.", en: "A chain of squares and intersections with an exact area." },
    file: "examples/sunset-square-city.json",
  },
  {
    id: "t19",
    title: { ru: "Точка на эллипсе", en: "Point on an ellipse" },
    description: { ru: "Определяющее свойство эллипса даёт равенство сумм расстояний.", en: "The defining property of an ellipse gives an equality of distance sums." },
    file: "examples/t19.json",
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
