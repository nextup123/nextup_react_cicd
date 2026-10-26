import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../../components/ui";
import { usePoints } from "../../lib/queries";
import { toast } from "../../store/toast";
import { JogPanel } from "./JogPanel";
import { PointListCard } from "./PointList";
import { PointEditorModal } from "./PointEditorModal";
import { MoveToPointModal, PointDetailsModal } from "./PointModals";
import { AccessManagerModal } from "./AccessManagerModal";
import { JogPadWindow } from "./JogPadWindow";
import { NexSimDocked, NexSimDropZone, NexSimFloating, useNexSimViewer } from "./NexSimView";
import { useJogSafety } from "./jogEngine";
import { guardIdle } from "../../lib/interlock";
import { currentPointStore, refreshPoints } from "./pointsApi";
import "./points.css";

const LAYOUT_KEY = "nextup.pp.layout";
// Column widths start equal; each may be resized between these shares.
const MIN_SHARE = 0.24;
const MAX_SHARE = 0.44;
const DEFAULT_LAYOUT = { cols: [1 / 3, 1 / 3, 1 / 3], detached: false, float: null };

function readLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
    if (!raw || !Array.isArray(raw.cols) || raw.cols.length !== 3) return DEFAULT_LAYOUT;
    return { ...DEFAULT_LAYOUT, ...raw };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Drag handle between two columns; `index` is the column on its left. */
function Splitter({ index, gridRef, layout, setLayout }) {
  const op = useRef(null);
  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const width = gridRef.current?.getBoundingClientRect().width || 1;
    op.current = { x: e.clientX, cols: [...layout.cols], width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const o = op.current;
    if (!o) return;
    const delta = (e.clientX - o.x) / o.width;
    const cols = [...o.cols];
    const pair = cols[index] + cols[index + 1];
    let left = Math.min(Math.max(o.cols[index] + delta, MIN_SHARE), MAX_SHARE);
    let right = pair - left;
    if (right < MIN_SHARE) [right, left] = [MIN_SHARE, pair - MIN_SHARE];
    if (right > MAX_SHARE) [right, left] = [MAX_SHARE, pair - MAX_SHARE];
    cols[index] = left;
    cols[index + 1] = right;
    setLayout((l) => ({ ...l, cols }));
  };
  const onUp = (e) => {
    op.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  return (
    <div
      className="pp-split"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => setLayout((l) => ({ ...l, cols: DEFAULT_LAYOUT.cols }))}
    />
  );
}

export default function PointsPage() {
  useJogSafety();
  const pointsQuery = usePoints();
  const points = pointsQuery.data || [];

  const [editor, setEditor] = useState({ open: false, point: null });
  const [details, setDetails] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [modal, setModal] = useState(null); // access
  const [jogPad, setJogPad] = useState(null); // keyboard | gamepad: floating, stays open beside dialogs
  const [currentPoint, setCurrentPoint] = useState(() => currentPointStore.get());
  const [layout, setLayout] = useState(readLayout);
  const [overZone, setOverZone] = useState(false);
  const gridRef = useRef(null);
  const zoneRef = useRef(null);
  const nx = useNexSimViewer(points, currentPoint);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [layout]);

  const closeModal = useCallback(() => setModal(null), []);

  const reload = async () => {
    const res = await pointsQuery.refetch();
    refreshPoints();
    if (res.isError) toast.error("Failed to reload points");
    else toast.success(`Reloaded ${res.data?.length ?? 0} points`);
  };

  const onMoved = (name) => {
    currentPointStore.set(name);
    setCurrentPoint(name);
  };

  const [a, b, c] = layout.cols;
  // detached 3D view: the list takes the room, the jog panel keeps a comfortable width
  const columns = layout.detached ? "minmax(0, 1fr) 56px minmax(320px, 600px)" : `${a}fr 10px ${b}fr 10px ${c}fr`;

  return (
    <div className="page page-fill pp-page">
      <div ref={gridRef} className={cx("pp-grid", layout.detached && "is-detached")} style={{ gridTemplateColumns: columns }}>
        <div className="pp-col pp-col-list">
          <PointListCard
            query={pointsQuery}
            currentPoint={currentPoint}
            onAdd={() => guardIdle("teach a point") && setEditor({ open: true, point: null })}
            onEdit={(p) => {
              if (!guardIdle("change the points")) return;
              setDetails(null);
              setEditor({ open: true, point: p });
            }}
            onDetails={setDetails}
            onMove={setMoveTarget}
            onAccess={() => setModal("access")}
            onReload={reload}
            reloading={pointsQuery.isFetching && !pointsQuery.isLoading}
          />
        </div>
        {layout.detached ? (
          <NexSimDropZone zoneRef={zoneRef} over={overZone} active onAttach={() => setLayout((l) => ({ ...l, detached: false }))} />
        ) : (
          <>
            <Splitter index={0} gridRef={gridRef} layout={layout} setLayout={setLayout} />
            <div className="pp-col pp-col-sim" data-tut="pp-3d">
              <NexSimDocked nx={nx} onDetach={() => setLayout((l) => ({ ...l, detached: true }))} />
            </div>
            <Splitter index={1} gridRef={gridRef} layout={layout} setLayout={setLayout} />
          </>
        )}
        <div className="pp-col pp-col-jog">
          <JogPanel points={points} onTool={setJogPad} />
        </div>
      </div>

      {layout.detached && (
        <NexSimFloating
          nx={nx}
          geom={layout.float}
          onGeom={(float) => setLayout((l) => ({ ...l, float }))}
          onAttach={() => setLayout((l) => ({ ...l, detached: false }))}
          zoneRef={zoneRef}
          onOverZone={setOverZone}
        />
      )}

      <PointEditorModal open={editor.open} point={editor.point} publishEdits onClose={() => setEditor({ open: false, point: null })} />
      <PointDetailsModal
        point={details}
        onClose={() => setDetails(null)}
        onEdit={(p) => {
          if (!guardIdle("change the points")) return;
          setDetails(null);
          setEditor({ open: true, point: p });
        }}
      />
      <MoveToPointModal point={moveTarget} onClose={() => setMoveTarget(null)} onMoved={onMoved} />
      <AccessManagerModal open={modal === "access"} onClose={closeModal} points={points} />
      {jogPad && <JogPadWindow tab={jogPad} onTab={setJogPad} onClose={() => setJogPad(null)} />}
    </div>
  );
}
