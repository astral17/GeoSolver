"use client";

import { useRef, useState } from "react";
import {
  PROJECT_EXAMPLE_CATEGORIES,
  PROJECT_EXAMPLES,
  projectExampleCategory,
  type ProjectExampleCategoryId,
  type ProjectExample,
} from "./examples";
import type { Locale } from "./i18n";
import { SYMBOL_COMMANDS } from "./symbol-commands";

type HelpTool = {
  id: string;
  label: string;
  hint: string;
  shortcut: string;
};

const HELP_TOOL_GROUPS: Record<string, string> = {
  segment: "Линии",
  line: "Линии",
  ray: "Линии",
  polyline: "Линии",
  circle: "Окружности",
  ellipse: "Окружности",
  sector: "Окружности",
  circularSegment: "Окружности",
  polygon: "Многоугольники",
  crossedPolygon: "Многоугольники",
  regularPolygon: "Многоугольники",
  triangle: "Треугольники",
  rightTriangle: "Треугольники",
  isoscelesTriangle: "Треугольники",
  equilateralTriangle: "Треугольники",
  quadrilateral: "Четырёхугольники",
  square: "Четырёхугольники",
  rectangle: "Четырёхугольники",
  parallelogram: "Четырёхугольники",
  trapezoid: "Четырёхугольники",
  rhombus: "Четырёхугольники",
  setLength: "Задать условие",
  setAngle: "Задать условие",
  setArea: "Задать условие",
};

const HELP_TOOL_GROUPS_EN: Record<string, string> = {
  segment: "Lines",
  line: "Lines",
  ray: "Lines",
  polyline: "Lines",
  circle: "Circles",
  ellipse: "Circles",
  sector: "Circles",
  circularSegment: "Circles",
  polygon: "Polygons",
  crossedPolygon: "Polygons",
  regularPolygon: "Polygons",
  triangle: "Triangles",
  rightTriangle: "Triangles",
  isoscelesTriangle: "Triangles",
  equilateralTriangle: "Triangles",
  quadrilateral: "Quadrilaterals",
  square: "Quadrilaterals",
  rectangle: "Quadrilaterals",
  parallelogram: "Quadrilaterals",
  trapezoid: "Quadrilaterals",
  rhombus: "Quadrilaterals",
  setLength: "Set condition",
  setAngle: "Set condition",
  setArea: "Set condition",
};

export function HelpDialog({
  tools,
  locale,
  onLoadExample,
  onClose,
}: {
  tools: HelpTool[];
  locale: Locale;
  onLoadExample: (example: ProjectExample) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  if (locale === "en") {
    return (
      <EnglishHelpDialog
        tools={tools}
        onLoadExample={onLoadExample}
        onClose={onClose}
      />
    );
  }
  const goToSection = (id: string) => {
    contentRef.current
      ?.querySelector<HTMLElement>(`#${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="help-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-header">
          <div>
            <span>СПРАВКА</span>
            <h1 id="help-title">Как пользоваться GeoSolver</h1>
            <p>Построения, ограничения и численный поиск — в одном месте.</p>
          </div>
          <button onClick={onClose} aria-label="Закрыть справку" autoFocus>
            ×
          </button>
        </header>

        <div className="help-body">
          <nav className="help-nav" aria-label="Разделы справки">
            <button type="button" onClick={() => goToSection("help-start")}>
              Быстрый старт
            </button>
            <button type="button" onClick={() => goToSection("help-examples")}>
              Готовые примеры
            </button>
            <button type="button" onClick={() => goToSection("help-tools")}>
              Инструменты
            </button>
            <button
              type="button"
              onClick={() => goToSection("help-constraints")}
            >
              Ограничения
            </button>
            <button type="button" onClick={() => goToSection("help-formulas")}>
              Формулы и координаты
            </button>
            <button type="button" onClick={() => goToSection("help-targets")}>
              Цели и измерения
            </button>
            <button type="button" onClick={() => goToSection("help-symbols")}>
              Ввод символов
            </button>
            <button type="button" onClick={() => goToSection("help-solver")}>
              Решатель
            </button>
            <button type="button" onClick={() => goToSection("help-shortcuts")}>
              Горячие клавиши
            </button>
          </nav>

          <div className="help-content" ref={contentRef}>
            <section id="help-start" className="help-section">
              <span className="help-kicker">01 · НАЧАЛО РАБОТЫ</span>
              <h2>От рисунка к ответу</h2>
              <ol className="help-steps">
                <li>
                  <b>Постройте чертёж.</b>
                  <span>
                    Расставьте точки и соедините их отрезками, прямыми,
                    лучами, окружностями или многоугольниками.
                  </span>
                </li>
                <li>
                  <b>Запишите известные данные.</b>
                  <span>
                    Например, <code>AB = 5</code>,{" "}
                    <code>∠ABC = 90°</code> или{" "}
                    <code>A = (0, 0)</code>.
                  </span>
                </li>
                <li>
                  <b>Добавьте цели.</b>
                  <span>
                    Запись <code>BC</code> просит найти длину, а{" "}
                    <code>S(ABCD)</code> — площадь, а{" "}
                    <code>P(ABCD)</code> — периметр. Суффикс{" "}
                    <code>= ?</code> добавится автоматически.
                  </span>
                </li>
                <li>
                  <b>Запустите решатель.</b>
                  <span>
                    Нажмите <kbd>Ctrl</kbd> + <kbd>Enter</kbd>. Чертёж
                    перестроится под найденное решение.
                  </span>
                </li>
              </ol>
              <div className="help-callout">
                Все данные остаются в браузере. Каждая вкладка хранит отдельный
                чертёж.
              </div>
              <div className="help-callout">
                Название проекта редактируется прямо в шапке и сохраняется
                автоматически. Команды «Импорт» и «Экспорт» в настройках
                переносят проект через JSON-файл; для импорта файл также можно
                перетащить в окно. Текущая версия формата — 2; старые файлы
                мигрируют автоматически, включая прежнюю семантику пересечений.
              </div>
              <div className="help-callout theme-help-callout">
                Светлая и тёмная темы переключаются в настройках. Выбор
                сохраняется в браузере.
              </div>
              <div className="help-callout mobile-help-callout">
                На телефоне кнопки «Условия», «Чертёж» и «Решение» в шапке
                переключают полноширинные рабочие экраны. Повторное нажатие на
                активные «Условия» или «Решение» возвращает к чертежу. В
                альбомной ориентации шапка становится компактной, а
                прокручиваемая панель инструментов располагается слева.
                Чертёж масштабируется жестом двумя пальцами.
              </div>
            </section>

            <section id="help-examples" className="help-section">
              <span className="help-kicker">02 · ГОТОВЫЕ ПРОЕКТЫ</span>
              <h2>Примеры для экспериментов</h2>
              <p>
                Пример заменит текущий чертёж и сразу откроется в основном
                редакторе. Его можно свободно менять и сохранять как обычный
                проект. Каждый пример хранится отдельным JSON-файлом и
                загружается тем же импортёром, что и пользовательский файл.
              </p>
              <HelpProjectExamples
                locale="ru"
                onLoadExample={onLoadExample}
              />
            </section>

            <section id="help-tools" className="help-section">
              <span className="help-kicker">03 · ЧЕРТЁЖ</span>
              <h2>Инструменты</h2>
              <p>
                Выберите инструмент кнопкой или горячей клавишей. Вложенные
                варианты раскрываются нажатием на кнопку секции и выбираются
                стрелками, цифрами или касанием. Горячая клавиша секции сразу
                активирует текущий либо первый инструмент в ней, а цифры
                относятся только к пунктам уже открытой секции. На мобильном
                устройстве повторное нажатие на раскрытую секцию закрывает её
                без выбора.
              </p>
              <p>
                В каталоге объектов для каждой фигуры доступен одинаковый
                полный список типов. Если новому типу требуется другое число
                точек или поле заполнено неверно, ошибка сразу появляется под
                редактируемым объектом. Стрелки продолжают навигацию через
                объекты, условия и цели; при входе в пустую секцию формул
                создаётся пустая строка. Скрытие фигуры также скрывает её
                штрихи равенства, дуги углов и связанные подписи.
              </p>
              <p>
                Единый тип <b>«Уравнение»</b> задаёт неявное множество точек.
                Редактор определяет вид автоматически: равенство рисует границу,
                а неравенство — область. Например, объект <code>f1</code>
                с формулой <code>(x - x(A))^2 + (y - y(A))^2 = 3^2</code>
                рисует окружность, а знак <code>≤</code> заполняет круг.
                Координаты <code>x</code> и <code>y</code> внутри такого объекта
                локальные; при совпадении с внешней переменной редактор выводит
                предупреждение. Имя объекта используется в <code>S(f1)</code>,
                <code>distance(f1, AB)</code> и операциях множеств.
              </p>
              <p>
                Пара <code>(x; y)</code> является вычисляемой точкой, а не
                обычными скобками. Координатами могут быть формулы, поэтому
                допустимы <code>distance((1; a), C)</code>,{" "}
                <code>distance((1; 2), circle(AB))</code>,{" "}
                <code>angle((0; 0), A, (1; 0))</code> и{" "}
                <code>S((0; 0), A, B)</code>. Последовательность из двух пар
                задаёт отрезок, а из трёх и более — многоугольник, например{" "}
                <code>S((0; 0)(4; 0)(0; 3))</code>.
              </p>
              <p>
                Кнопка <code>⊞</code> в заголовке секции создаёт именованную
                группу объектов, условий или целей. Перетащите строку на
                заголовок развёрнутой группы, чтобы внести её, либо на тонкую
                линию после группы, чтобы перенести через нижнюю границу в
                любом направлении. У свёрнутой группы такой зоны нет, и новые
                строки она не принимает. Группу можно переименовать и
                свернуть. Сами группы перемещаются за ручку <code>⠿</code> или
                сочетанием <code>Alt+↑/↓</code>; группу можно опустить прямо
                над или под обычной строкой. Для переноса за открытую группу
                достаточно нижней половины её заголовка. Порядок меняется
                сразу. Закрытая группа
                считается одним шагом и не заставляет строку перепрыгивать
                следующую группу. Вместе с заголовком переносится всё
                содержимое. При обычной навигации{" "}
                <code>↑/↓</code> имя группы является отдельным шагом между
                соседними строками.
                Кнопка <code>◎</code> у фигуры или группы выделяет все
                связанные точки; после этого их можно перемещать вместе.
              </p>
              <div className="help-table-wrap">
                <table className="help-table">
                  <thead>
                    <tr>
                      <th>Инструмент</th>
                      <th>Расположение</th>
                      <th>Действие</th>
                      <th>Клавиша</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <tr key={tool.id}>
                        <td>{tool.label}</td>
                        <td>
                          {HELP_TOOL_GROUPS[tool.id] ? (
                            <span className="help-group-badge">
                              Секция · {HELP_TOOL_GROUPS[tool.id]}
                            </span>
                          ) : (
                            <span className="help-rail-badge">
                              Основная панель
                            </span>
                          )}
                        </td>
                        <td>{tool.hint}</td>
                        <td>
                          <kbd>{tool.shortcut}</kbd>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Ломаная и инструмент задания площади завершаются повторным
                нажатием на последнюю выбранную точку; многоугольник замыкается
                нажатием на выбранную вершину. Для удаления нескольких объектов
                сначала выделите их рамкой.
              </p>
              <p>
                Эллипс задаётся двумя фокусами и третьей точкой на его границе.
                Инструмент точки пересечения создаёт точку одним кликом рядом с
                двумя границами — включая линии, окружности, эллипсы, секторы и
                сегменты. Если объекты находятся далеко друг от друга, выберите
                их последовательно двумя кликами. Сектор всегда идёт от первого
                радиуса ко второму по часовой стрелке; перестановка крайних точек
                выбирает дополнительный сектор.
              </p>
            </section>

            <section id="help-constraints" className="help-section">
              <span className="help-kicker">04 · ИЗВЕСТНЫЕ ДАННЫЕ</span>
              <h2>Ограничения</h2>
              <p>
                Одна строка — одно условие. Распознанная строка отмечается
                зелёным статусом. Условия можно выключать, удалять и
                переупорядочивать за маркер слева: список перестраивается прямо
                во время перетаскивания мышью или пальцем. Кнопка{" "}
                <code>+</code> создаёт пустую строку, а соседняя стрелка
                открывает список примеров.
              </p>
              <div className="help-example-grid">
                <HelpExample code="AB = 5" text="фиксированная длина" />
                <HelpExample code="∠ABC = 60°" text="величина угла" />
                <HelpExample code="S(ABCD) = 12" text="площадь многоугольника" />
                <HelpExample
                  code="S(ABCD ∩ EFGH) = 5"
                  text="площадь общей области двух фигур"
                />
                <HelpExample code="AB ∥ CD" text="параллельные направления" />
                <HelpExample code="AB ⟂ CD" text="перпендикулярность" />
                <HelpExample code="A ≠ B" text="различные точки" />
                <HelpExample
                  code="distinct(ABCD)"
                  text="все перечисленные точки различны"
                />
                <HelpExample
                  code="AB ∩ CD = ∅"
                  text="отрезки не пересекаются"
                />
                <HelpExample
                  code="line(AB) ∩ circle(CD) = ∅"
                  text="прямая не пересекает окружность"
                />
                <HelpExample
                  code="distance(line(AB), circle(CD)) = 2"
                  text="расстояние между объектами"
                />
                <HelpExample
                  code="convex(ABCD)"
                  text="вершины образуют выпуклый многоугольник"
                />
                <HelpExample
                  code="ABC ∈ DEFG"
                  text="треугольник ABC находится внутри DEFG"
                />
                <HelpExample
                  code="A ∈ BCD"
                  text="точка A находится внутри треугольника BCD"
                />
                <HelpExample
                  code="H = EG ∩ DF"
                  text="H — единственная точка пересечения"
                />
                <HelpExample
                  code="H ∈ line(EG) ∩ circle(OA)"
                  text="H принадлежит пересечению; другие точки допустимы"
                />
                <HelpExample
                  code="{H, I} = circle(OA) ∩ circle(BC)"
                  text="полное множество точек пересечения"
                />
                <HelpExample
                  code="H = AB ∩ CD ∩ EF"
                  text="цепочка пересечений произвольной длины"
                />
                <HelpExample
                  code="H ∈ f1 ∪ ABC"
                  text="принадлежность объединению уравнения и фигуры"
                />
                <HelpExample code="D ∈ AB" text="точка на отрезке" />
                <HelpExample code="D ∈ line(AB)" text="точка на прямой" />
                <HelpExample code="D ∈ ray(AB)" text="точка на луче" />
                <HelpExample code="D ∈ circle(OA)" text="точка на окружности" />
                <HelpExample code="D ∈ arc(OAB)" text="точка на видимой дуге" />
                <HelpExample
                  code="D ∈ ellipse(OAB)"
                  text="точка на эллипсе"
                />
              </div>
              <p>
                Выражение слева и справа от <code>∩</code> задаёт объекты, а
                фигурные скобки — множество точек. Равенство требует, чтобы
                перечисленные точки были <em>всем</em> пересечением: запись{" "}
                <code>H = EG ∩ DF</code> является сокращением{" "}
                <code>{"{H}"} = EG ∩ DF</code>. Принадлежность{" "}
                <code>{"{H, I}"} ∈ … ∩ …</code> не запрещает дополнительные
                точки. Пустое множество можно писать с любой стороны:
                <code> ∅ = AB ∩ CD</code> или <code>AB ∩ CD = ∅</code>.
                Пересечение имеет приоритет над объединением <code>∪</code>;
                порядок можно явно задать скобками. Команды <code>\cap</code>
                и <code>\cup</code> превращаются в соответствующие символы.
              </p>
              <div className="help-callout warning">
                Если строка ссылается на удалённую точку, GeoSolver покажет
                ошибку ссылки и не будет считать условие корректным.
              </div>
            </section>

            <section id="help-formulas" className="help-section">
              <span className="help-kicker">05 · АЛГЕБРА</span>
              <h2>Формулы, переменные и координаты</h2>
              <p>
                Длины записываются двумя буквами, углы — тремя буквами с
                вершиной посередине. Поддерживаются <code>+ − × ÷ ^</code>,
                скобки, <code>sqrt</code>, <code>abs</code>,{" "}
                <code>sin</code>, <code>cos</code> и <code>tan</code>.
              </p>
              <p>
                Функция <code>distance</code> вычисляет минимальное расстояние
                между точками, отрезками, прямыми, лучами, окружностями,
                эллипсами и замкнутыми фигурами. Например:{" "}
                <code>distance(A, line(BC))</code> или{" "}
                <code>distance(polygon(ABC), circle(DE))</code>. При
                пересечении результат равен нулю.
              </p>
              <div className="help-example-grid">
                <HelpExample code="AB + BC = AC" text="формула длин" />
                <HelpExample code="AB² + AC² = BC²" text="степени" />
                <HelpExample code="∠ABC = ∠BCA + 10°" text="формула углов" />
                <HelpExample code="AB = BC = CD" text="цепочка равенств" />
                <HelpExample code="AB != BC" text="неравные длины" />
                <HelpExample code="0 < AB <= 10" text="цепочка неравенств" />
                <HelpExample code="x(A) ≥ 0" text="граница координаты" />
                <HelpExample code="a = AB" text="определение переменной" />
                <HelpExample code="b = 2*a" text="выражение через переменную" />
                <HelpExample code="x(A) = 2" text="координата по оси x" />
                <HelpExample code="y(A) = -1" text="координата по оси y" />
                <HelpExample code="A = (2, -1)" text="обе координаты" />
                <HelpExample
                  code="A = (a, b + 1)"
                  text="координаты через выражения"
                />
              </div>
              <div className="help-callout">
                Равные стороны из условий вроде <code>AB = BC = CD</code>{" "}
                автоматически отмечаются на чертеже одинаковым числом штрихов.
                Это работает и для частей объекта, например при{" "}
                <code>D ∈ AC</code> и <code>AD = DC</code>. Разные группы
                равных сторон получают разное число штрихов.
              </div>
              <p>
                Для десятичной запятой в паре координат разделяйте компоненты
                точкой с запятой: <code>A = (1,5; -2,5)</code>. Единицу
                углов без знака <code>°</code> можно выбрать в настройках;
                <code>\deg</code> всегда явно задаёт градусы.
                Для сравнений работают <code>!= ≠ &lt; &gt; &lt;= &gt;= ≤ ≥</code>.
              </p>
            </section>

            <section id="help-targets" className="help-section">
              <span className="help-kicker">06 · РЕЗУЛЬТАТЫ</span>
              <h2>Цели и измерения</h2>
              <div className="help-columns">
                <div>
                  <h3>Что найти</h3>
                  <p>
                    Суффикс <code>= ?</code> необязателен: при выходе из поля
                    он добавляется автоматически. Примеры:
                  </p>
                  <ul>
                    <li><code>AB</code> — длина;</li>
                    <li><code>∠ABC</code> — угол;</li>
                    <li><code>S(ABCD)</code> — площадь;</li>
                    <li><code>P(ABCD)</code> — периметр;</li>
                    <li>
                      <code>S(circle(AB))</code>,{" "}
                      <code>S(sector(ABC))</code>,{" "}
                      <code>S(segment(ABC))</code>,{" "}
                      <code>S(ellipse(ABC))</code> — площади круглых фигур;
                    </li>
                    <li>
                      <code>S(ABCD ∩ EFGH)</code> или{" "}
                      <code>S(circle(AB) ∩ polygon(CDEF))</code> — площадь
                      пересечения фигур;
                    </li>
                    <li><code>AB + BC</code> — значение формулы.</li>
                  </ul>
                  <p>
                    Цель без <code>?</code> может быть утверждением:{" "}
                    <code>AB = BC</code>, <code>∠ABC = ∠DEF</code>,{" "}
                    <code>AB ⟂ CD</code>, <code>AB ∥ CD</code> или{" "}
                    <code>AB &lt; BC</code>. Аналитический режим пытается
                    доказать либо опровергнуть её. Численный контрпример может
                    опровергнуть утверждение, но совпадение в одном найденном
                    чертеже само по себе доказательством не считается.
                  </p>
                </div>
                <div>
                  <h3>Измерения</h3>
                  <p>
                    Инструменты измерения показывают фактическое значение на
                    текущем чертеже и не добавляют ограничений, целей или новых
                    точек. Перетаскивание пустого места перемещает камеру, но
                    не геометрические объекты.
                  </p>
                  <ul>
                    <li>длина — выберите две существующие точки;</li>
                    <li>угол — выберите три существующие точки;</li>
                    <li>
                      площадь — кликните свободную часть границы готовой фигуры
                      для быстрого измерения либо нажимайте именно на точки,
                      чтобы вручную обойти желаемые вершины и замкнуть список.
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <section id="help-symbols" className="help-section">
              <span className="help-kicker">07 · УДОБНЫЙ ВВОД</span>
              <h2>Команды специальных символов</h2>
              <p>
                В условиях и целях введите обратную косую черту и название
                команды. Как только команда распознана, она автоматически
                свернётся в символ. Например,{" "}
                <code>\angle ABC = 90\deg</code> превратится в{" "}
                <code>∠ABC = 90°</code>.
              </p>
              <div className="help-symbol-grid">
                {SYMBOL_COMMANDS.map((item) => (
                  <div key={item.command}>
                    <code>\{item.command}</code>
                    <b>{item.symbol}</b>
                    <span>{item.purpose}</span>
                  </div>
                ))}
              </div>
              <p>
                Неизвестная команда остаётся обычным текстом, поэтому ввод не
                теряется.
              </p>
            </section>

            <section id="help-solver" className="help-section">
              <span className="help-kicker">08 · ДВА РЕЖИМА</span>
              <h2>Как работает решатель</h2>
              <p>
                Режим выбирается в настройках. Численный решатель подходит для
                общей системы ограничений и перемещает точки. Аналитический
                применяет поддерживаемые теоремы, сохраняет кратчайшую найденную
                цепочку, возвращает точные выражения вроде{" "}
                <code>3*sqrt(2)/4</code>, а затем численно перестраивает чертёж.
              </p>
              <div className="help-columns">
                <div>
                  <h3>Параметр ε</h3>
                  <p>
                    Допуск определяет, когда поиск можно остановить и считать
                    решение точным. Значение по умолчанию — <code>1e-6</code>.
                    Меньшее значение требует более точного совпадения, но может
                    увеличить время поиска. Эпсилон находится в настройках.
                    Там же задаются максимальное количество итераций и
                    временной лимит. В аналитическом режиме этот лимит общий
                    для точного вывода и численной перестройки чертежа; при его
                    достижении сохраняется уже найденный результат.
                  </p>
                </div>
                <div>
                  <h3>Область аналитики</h3>
                  <p>
                    Поддерживаются равенства и формулы, коллинеарность и перенос
                    перпендикулярности, теоремы Пифагора и косинусов, точные значения
                    тригонометрии для стандартных углов, свойства квадратов,
                    прямоугольников и правильных многоугольников, касающиеся
                    окружности, повороты равносторонних конструкций и разбиения
                    площадей. Если выполнена только часть целей, решатель
                    отдельно перечисляет оставшиеся; неединственный ответ не
                    выдаётся за точный.
                  </p>
                </div>
              </div>
            </section>

            <section id="help-shortcuts" className="help-section">
              <span className="help-kicker">09 · КЛАВИАТУРА</span>
              <h2>Горячие клавиши</h2>
              <div className="help-shortcut-grid">
                <HelpShortcut keys="Ctrl + Z" text="отменить действие" />
                <HelpShortcut keys="Ctrl + Y" text="повторить действие" />
                <HelpShortcut keys="Ctrl + Enter" text="запустить решатель" />
                <HelpShortcut
                  keys="Shift + Enter"
                  text="сохранить строку и создать следующую"
                />
                <HelpShortcut
                  keys="Enter / Escape"
                  text="завершить редактирование строки"
                />
                <HelpShortcut keys="↑ / ↓" text="перейти к соседней строке" />
                <HelpShortcut
                  keys="Alt + ↑ / ↓"
                  text="переместить строку или группу"
                />
                <HelpShortcut keys="Delete" text="удалить выделенные точки" />
                <HelpShortcut keys="Escape" text="сбросить текущий инструмент" />
                <HelpShortcut keys="F1 или ?" text="открыть эту справку" />
              </div>
              <p>
                Горячие клавиши инструментов указаны на самих кнопках и в
                таблице инструментов выше. Они работают независимо от раскладки
                клавиатуры.
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function EnglishHelpDialog({
  tools,
  onLoadExample,
  onClose,
}: {
  tools: HelpTool[];
  onLoadExample: (example: ProjectExample) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const goToSection = (id: string) => {
    contentRef.current
      ?.querySelector<HTMLElement>(`#${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const navigation = [
    ["help-start-en", "Quick start"],
    ["help-examples-en", "Ready examples"],
    ["help-tools-en", "Tools"],
    ["help-constraints-en", "Constraints"],
    ["help-formulas-en", "Formulas"],
    ["help-targets-en", "Targets"],
    ["help-symbols-en", "Symbols"],
    ["help-solver-en", "Solver"],
    ["help-shortcuts-en", "Shortcuts"],
  ] as const;

  return (
    <div
      className="help-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title-en"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-header">
          <div>
            <span>HELP</span>
            <h1 id="help-title-en">Using GeoSolver</h1>
            <p>Constructions, constraints and numerical search in one place.</p>
          </div>
          <button onClick={onClose} aria-label="Close help" autoFocus>
            ×
          </button>
        </header>

        <div className="help-body">
          <nav className="help-nav" aria-label="Help sections">
            {navigation.map(([id, label]) => (
              <button key={id} type="button" onClick={() => goToSection(id)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="help-content" ref={contentRef}>
            <section id="help-start-en" className="help-section">
              <span className="help-kicker">01 · GETTING STARTED</span>
              <h2>From a drawing to an answer</h2>
              <ol className="help-steps">
                <li>
                  <b>Build a drawing.</b>
                  <span>Add points, lines, circles and polygons.</span>
                </li>
                <li>
                  <b>Enter known facts.</b>
                  <span>
                    For example <code>AB = 5</code>,{" "}
                    <code>∠ABC = 90°</code> or <code>A = (0, 0)</code>.
                  </span>
                </li>
                <li>
                  <b>Add targets.</b>
                  <span>
                    Use <code>BC</code> for a length or{" "}
                    <code>S(ABCD)</code> for an area and{" "}
                    <code>P(ABCD)</code> for a perimeter. The optional{" "}
                    <code>= ?</code> suffix is added automatically.
                  </span>
                </li>
                <li>
                  <b>Run the solver.</b>
                  <span>
                    Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd>.
                  </span>
                </li>
              </ol>
              <div className="help-callout">
                Data stays in your browser. Each browser tab has its own
                drawing. Project JSON import and export are in Settings.
                Format version 3 automatically migrates older intersection
                constraints.
              </div>
            </section>

            <section id="help-examples-en" className="help-section">
              <span className="help-kicker">02 · READY PROJECTS</span>
              <h2>Examples to explore</h2>
              <p>
                Loading an example replaces the current drawing and opens it
                in the main editor. You can edit and save it like any project.
                Each example is a separate JSON file processed by the regular
                project importer.
              </p>
              <HelpProjectExamples
                locale="en"
                onLoadExample={onLoadExample}
              />
            </section>

            <section id="help-tools-en" className="help-section">
              <span className="help-kicker">03 · DRAWING</span>
              <h2>Tools</h2>
              <p>
                Choose a tool from the rail or with its shortcut. Group buttons
                open nested tools; use arrows, digits or touch to choose one.
                A group shortcut immediately activates its current or first
                tool, while digits only select items in the already open
                group. Pinch the drawing with two fingers to zoom it.
              </p>
              <p>
                The object catalog uses the same complete type list for every
                shape. If the selected type needs a different number of
                points or a field is invalid, the error appears immediately
                below the object being edited. Arrow keys continue through objects, conditions and
                targets; entering an empty formula section creates a blank
                row. Hiding a shape also hides its equality ticks, angle arcs
                and related annotations.
              </p>
              <p>
                The single <b>Equation</b> type defines implicit point sets.
                Equality draws a boundary, while an inequality creates a region
                automatically. For example, an object named <code>f1</code> with{" "}
                <code>(x - x(A))^2 + (y - y(A))^2 = 3^2</code> draws a circle;
                replacing equality with <code>≤</code> fills its disk. The local
                coordinates <code>x</code> and <code>y</code> shadow external
                variables, which is reported below the object row. Use the name
                in <code>S(f1)</code>, <code>distance(f1, AB)</code>, and set
                expressions.
              </p>
              <p>
                A pair such as <code>(x; y)</code> is a computed point rather
                than grouping parentheses. Its coordinates may be formulas,
                so <code>distance((1; a), C)</code>,{" "}
                <code>distance((1; 2), circle(AB))</code>,{" "}
                <code>angle((0; 0), A, (1; 0))</code>, and{" "}
                <code>S((0; 0), A, B)</code> are valid. Two adjacent pairs
                form a segment; three or more form a polygon, for example{" "}
                <code>S((0; 0)(4; 0)(0; 3))</code>.
              </p>
              <p>
                The <code>⊞</code> button in a section header creates a named
                group of objects, conditions or targets. Drag a row onto an
                expanded group header to place it inside, or onto the thin line
                after the group to move it across the lower boundary in either
                direction. Collapsed groups have no such zone and do not accept
                new rows. Groups can be renamed and collapsed. Drag a group by
                its <code>⠿</code> handle or use <code>Alt+↑/↓</code> to move
                it directly above or below a regular row, together with all
                its contents. Dropping on the lower half of an expanded
                group&apos;s header is enough to move below it. The order
                changes immediately. A collapsed
                group counts as one step and never makes a row skip the next
                group. With regular{" "}
                <code>↑/↓</code> navigation, the group name is a separate step
                between adjacent rows. The{" "}
                <code>◎</code> button on a shape or group selects all related
                points so they can be moved together.
              </p>
              <div className="help-table-wrap">
                <table className="help-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Location</th>
                      <th>Action</th>
                      <th>Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <tr key={tool.id}>
                        <td>{tool.label}</td>
                        <td>
                          {HELP_TOOL_GROUPS_EN[tool.id] ? (
                            <span className="help-group-badge">
                              Group · {HELP_TOOL_GROUPS_EN[tool.id]}
                            </span>
                          ) : (
                            <span className="help-rail-badge">Main rail</span>
                          )}
                        </td>
                        <td>{tool.hint}</td>
                        <td>
                          <kbd>{tool.shortcut}</kbd>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                A sector always follows the clockwise sweep from the first
                radius to the second. Swap those two points to select the
                complementary sector. A circular segment draws the region
                between a chord and its arc.
              </p>
              <p>
                A polyline and the Set area tool finish when you click the last
                selected point again. A polygon closes when you click one of
                its selected vertices.
              </p>
              <p>
                An ellipse is defined by two foci and a third point on its
                boundary. The Intersection point tool creates a point with one
                click near two boundaries, including lines, circles, ellipses,
                sectors, and circular segments; use two successive clicks when
                the objects are far apart.
              </p>
            </section>

            <section id="help-constraints-en" className="help-section">
              <span className="help-kicker">04 · KNOWN FACTS</span>
              <h2>Constraints</h2>
              <p>
                Enter one condition per row. Drag the handle to reorder rows in
                real time. You can disable or delete any row. The{" "}
                <code>+</code> button creates a blank row, while the adjacent
                arrow opens examples.
              </p>
              <div className="help-example-grid">
                <HelpExample code="AB = 5" text="fixed length" />
                <HelpExample code="∠ABC = 60°" text="angle value" />
                <HelpExample code="S(ABCD) = 12" text="polygon area" />
                <HelpExample
                  code="S(ABCD ∩ EFGH) = 5"
                  text="area shared by two figures"
                />
                <HelpExample code="AB ∥ CD" text="parallel directions" />
                <HelpExample code="AB ⟂ CD" text="perpendicular directions" />
                <HelpExample code="distinct(ABCD)" text="distinct points" />
                <HelpExample code="AB ∩ CD = ∅" text="no intersection" />
                <HelpExample
                  code="line(AB) ∩ circle(CD) = ∅"
                  text="line does not intersect a circle"
                />
                <HelpExample
                  code="distance(line(AB), circle(CD)) = 2"
                  text="distance between objects"
                />
                <HelpExample code="convex(ABCD)" text="convex polygon" />
                <HelpExample
                  code="ABC ∈ DEFG"
                  text="triangle ABC lies inside DEFG"
                />
                <HelpExample
                  code="A ∈ BCD"
                  text="point A lies inside triangle BCD"
                />
                <HelpExample
                  code="H = EG ∩ DF"
                  text="H is the only intersection point"
                />
                <HelpExample
                  code="H ∈ line(EG) ∩ circle(OA)"
                  text="H belongs to the intersection; more points are allowed"
                />
                <HelpExample
                  code="{H, I} = circle(OA) ∩ circle(BC)"
                  text="the complete intersection set"
                />
                <HelpExample
                  code="H = AB ∩ CD ∩ EF"
                  text="an intersection chain of arbitrary length"
                />
                <HelpExample
                  code="H ∈ f1 ∪ ABC"
                  text="membership in a union of an equation and a shape"
                />
                <HelpExample code="D ∈ circle(OA)" text="point on a circle" />
                <HelpExample code="D ∈ arc(OAB)" text="point on a visible arc" />
                <HelpExample
                  code="D ∈ ellipse(OAB)"
                  text="point on an ellipse"
                />
              </div>
              <p>
                Equality specifies the complete intersection set. Thus{" "}
                <code>H = EG ∩ DF</code> abbreviates{" "}
                <code>{"{H}"} = EG ∩ DF</code>. Membership such as{" "}
                <code>{"{H, I}"} ∈ … ∩ …</code> permits additional points.
                The empty set is accepted on either side of equality.
                Intersection binds tighter than union; parentheses override the
                order. <code>\cap</code> and <code>\cup</code> expand to their
                set symbols.
              </p>
              <div className="help-callout warning">
                A constraint that references a deleted point is marked as an
                invalid reference and is not treated as valid.
              </div>
            </section>

            <section id="help-formulas-en" className="help-section">
              <span className="help-kicker">05 · ALGEBRA</span>
              <h2>Formulas, variables and coordinates</h2>
              <p>
                Expressions support <code>+ − × ÷ ^</code>, parentheses,{" "}
                <code>sqrt</code>, <code>abs</code>, trigonometric functions
                and chained equalities or comparisons.
              </p>
              <p>
                <code>distance</code> returns the minimum distance between
                points, segments, lines, rays, circles, ellipses and closed
                shapes. Examples: <code>distance(A, line(BC))</code> and{" "}
                <code>distance(polygon(ABC), circle(DE))</code>. Intersecting
                objects have distance zero.
              </p>
              <div className="help-example-grid">
                <HelpExample code="AB + BC = AC" text="length formula" />
                <HelpExample code="AB = BC = CD" text="equality chain" />
                <HelpExample code="0 < AB <= 10" text="comparison chain" />
                <HelpExample code="a = AB" text="named variable" />
                <HelpExample code="A = (2, -1)" text="point coordinates" />
                <HelpExample code="x(A) ≥ 0" text="coordinate bound" />
              </div>
            </section>

            <section id="help-targets-en" className="help-section">
              <span className="help-kicker">06 · RESULTS</span>
              <h2>Targets and measurements</h2>
              <p>
                The <code>= ?</code> suffix is optional and is appended when
                you leave the field. Targets can be <code>AB</code>,{" "}
                <code>∠ABC</code>, <code>S(ABCD)</code>,{" "}
                <code>P(ABCD)</code>, or a full formula. Circular geometry
                uses <code>S(circle(AB))</code>,{" "}
                <code>S(sector(ABC))</code>,{" "}
                <code>S(segment(ABC))</code>, and{" "}
                <code>S(ellipse(ABC))</code>. Replace <code>S</code> with{" "}
                <code>P</code> to get the boundary length. Measurement tools
                read the current solved drawing without adding constraints,
                targets or points. For area, click an empty part of a shape
                boundary to detect it automatically, or click existing points
                to build and close an exact vertex list manually.
                Use <code>S(ABCD ∩ EFGH)</code> or{" "}
                <code>S(circle(AB) ∩ polygon(CDEF))</code> for the overlap area.
                A target without <code>?</code> may be a proposition such as{" "}
                <code>AB = BC</code>, <code>∠ABC = ∠DEF</code>, or{" "}
                <code>AB ⟂ CD</code>. Analytical mode tries to prove or refute
                it. A numerical counterexample can refute it, while one matching
                numerical drawing is not treated as a proof.
              </p>
            </section>

            <section id="help-symbols-en" className="help-section">
              <span className="help-kicker">07 · INPUT</span>
              <h2>Special symbol commands</h2>
              <p>
                Backslash commands expand as you type. For example,{" "}
                <code>\angle ABC = 90\deg</code> becomes{" "}
                <code>∠ABC = 90°</code>.
              </p>
              <div className="help-symbol-grid">
                {SYMBOL_COMMANDS.map((item) => (
                  <div key={item.command}>
                    <code>\{item.command}</code>
                    <b>{item.symbol}</b>
                    <span>{item.purposeEn}</span>
                  </div>
                ))}
              </div>
            </section>

            <section id="help-solver-en" className="help-section">
              <span className="help-kicker">08 · TWO MODES</span>
              <h2>How the solver works</h2>
              <p>
                Select the solver in Settings. Numerical mode searches point
                coordinates with adaptive least squares and can return the
                nearest drawing. Analytical mode applies supported theorems,
                returns exact expressions such as <code>3*sqrt(2)/4</code>, shows
                its shortest found derivation, and then rebuilds drawing
                coordinates numerically. Its scope includes equations,
                collinearity, transferred perpendicularity, standard-angle
                trigonometry, the law of cosines, squares, regular polygons, tangent circles,
                equilateral rotations, area dissections, and basic areas and
                perimeters. The time limit in Settings covers both exact
                inference and numerical drawing reconstruction. Underdetermined
                values are not presented as exact.
              </p>
              <div className="help-callout">
                If analytical mode has no applicable theorem, it reports the
                target as undetermined instead of inventing an approximate proof.
              </div>
            </section>

            <section id="help-shortcuts-en" className="help-section">
              <span className="help-kicker">09 · KEYBOARD</span>
              <h2>Shortcuts</h2>
              <div className="help-shortcut-grid">
                <HelpShortcut keys="Ctrl + Z" text="undo" />
                <HelpShortcut keys="Ctrl + Y" text="redo" />
                <HelpShortcut keys="Ctrl + Enter" text="run the solver" />
                <HelpShortcut keys="Shift + Enter" text="save and add a row" />
                <HelpShortcut keys="Enter / Escape" text="finish editing" />
                <HelpShortcut keys="↑ / ↓" text="focus the adjacent row" />
                <HelpShortcut keys="Alt + ↑ / ↓" text="move a row or group" />
                <HelpShortcut keys="Delete" text="delete selected objects" />
                <HelpShortcut keys="F1 or ?" text="open help" />
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function HelpProjectExamples({
  locale,
  onLoadExample,
}: {
  locale: Locale;
  onLoadExample: (example: ProjectExample) => void;
}) {
  const [category, setCategory] = useState<ProjectExampleCategoryId>("basics");
  const examples = PROJECT_EXAMPLES.filter(
    (example) => projectExampleCategory(example) === category,
  );
  return (
    <div className="help-project-browser">
      <div className="help-project-tabs" role="tablist">
        {PROJECT_EXAMPLE_CATEGORIES.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={category === item.id}
            className={category === item.id ? "active" : ""}
            onClick={() => setCategory(item.id)}
            key={item.id}
          >
            {item.title[locale]}
            <span>
              {PROJECT_EXAMPLES.filter(
                (example) => projectExampleCategory(example) === item.id,
              ).length}
            </span>
          </button>
        ))}
      </div>
      <div className="help-project-grid">
        {examples.map((example) => (
          <article className="help-project-card" key={example.id}>
            <div>
              <b>{example.title[locale]}</b>
              <p>{example.description[locale]}</p>
            </div>
            <button type="button" onClick={() => onLoadExample(example)}>
              {locale === "ru" ? "Загрузить в редактор" : "Load in editor"}
              <span aria-hidden="true">→</span>
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function HelpExample({ code, text }: { code: string; text: string }) {
  return (
    <div className="help-example">
      <code>{code}</code>
      <span>{text}</span>
    </div>
  );
}

function HelpShortcut({ keys, text }: { keys: string; text: string }) {
  return (
    <div>
      <kbd>{keys}</kbd>
      <span>{text}</span>
    </div>
  );
}
