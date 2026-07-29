import { SYMBOL_COMMANDS } from "./symbol-commands";

const SYMBOL_COMMAND_MAP = new Map<string, string>(
  SYMBOL_COMMANDS.map(({ command, symbol }) => [command, symbol]),
);

export function expandSymbolCommands(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const replacements: {
    index: number;
    length: number;
    symbol: string;
  }[] = [];
  const expanded = value.replace(
    /\\([A-Za-z]+)/g,
    (match, command: string, index: number) => {
      const symbol = SYMBOL_COMMAND_MAP.get(command.toLowerCase());
      if (!symbol) return match;
      replacements.push({ index, length: match.length, symbol });
      return symbol;
    },
  );
  const adjustPosition = (position: number) =>
    replacements.reduce(
      (current, replacement) =>
        replacement.index + replacement.length <= position
          ? current + replacement.symbol.length - replacement.length
          : current,
      position,
    );
  return {
    value: expanded,
    selectionStart: adjustPosition(selectionStart),
    selectionEnd: adjustPosition(selectionEnd),
    changed: replacements.length > 0,
  };
}
