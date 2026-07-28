type ToolGlyphData = {
  id: string;
  icon: string;
};

export function ToolGlyph({ tool }: { tool: ToolGlyphData }) {
  if (tool.id === "select") {
    return <span className="tool-glyph cursor-tool-icon" aria-hidden="true" />;
  }
  if (tool.id === "marquee") {
    return (
      <span className="tool-glyph marquee-tool-icon" aria-hidden="true">
        <i />
      </span>
    );
  }
  if (tool.id === "point") {
    return (
      <span className="tool-glyph point-tool-icon" aria-hidden="true">
        <i />
      </span>
    );
  }
  if (tool.id === "pointOnSegment") {
    return (
      <span className="tool-glyph point-on-object-icon" aria-hidden="true">
        <i />
      </span>
    );
  }
  if (tool.id === "segment") {
    return (
      <span className="tool-glyph segment-tool-icon" aria-hidden="true">
        <i className="segment-shaft" />
        <i className="segment-tick segment-tick-start" />
        <i className="segment-tick segment-tick-end" />
      </span>
    );
  }
  return (
    <span className="tool-glyph" aria-hidden="true">
      {tool.icon}
    </span>
  );
}

export function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
