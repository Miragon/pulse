import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import OutlineModule from 'bpmn-js/lib/features/outline';
import { connectDiagramJs, shellModule } from '@miragon/modeler-shell/diagram-js';
import type { DiagramJsConnection } from '@miragon/modeler-shell/diagram-js';
import { persistView, readShellState } from '@miragon/modeler-shell/vscode/webview';
import type { ShellHandle } from '@miragon/modeler-shell';
import type { WebviewStateApi } from '@miragon/modeler-shell/vscode/webview';
import { CANVAS_TEXT_STYLE, CanvasRoles, RENDERER_COLORS } from './canvas-roles.js';
import { CanvasShell } from './canvas-shell.js';
import { DecorationLayer } from './decoration-layer.js';
import type {
  CanvasMarkersLike,
  Decorations,
  OverlaysLike,
  SelectionLike,
} from './decoration-layer.js';
import type { BadgeFilter } from './badge-cluster.js';
import { DiagramElements } from './diagram-elements.js';
import type { DiagramElement, ElementRegistryLike } from './diagram-elements.js';

export interface RuntimeCanvasOptions {
  readonly host: HTMLElement;
  readonly stateApi: WebviewStateApi;
  readonly onSelectElement: BadgeFilter;
  readonly onOpenCall: (elementId: string, toSide: boolean) => void;
  readonly onOpenCode: (elementId: string) => void;
  readonly onImported: (names: ReadonlyMap<string, string>) => void;
  readonly onImportFailed: (reason: string) => void;
  readonly remembersView?: boolean;
  readonly keysOnCanvas?: boolean;
}

interface RootedCanvasLike {
  getRootElement(): DiagramElement;
}

interface EventBusLike {
  on(event: string, listener: (event: { readonly element: DiagramElement }) => void): void;
}

interface Wanted {
  readonly xml: string;
  readonly decorations: Decorations;
}

export class RuntimeCanvas {
  private readonly shell: ShellHandle;
  private readonly disconnectShell: () => void;
  private readonly viewer: NavigatedViewer;
  private readonly connection: DiagramJsConnection;
  private readonly stopPersisting: () => void;
  private readonly registry: ElementRegistryLike;
  private readonly elements: DiagramElements;
  private layer: DecorationLayer | undefined;
  private importedXml: string | undefined;
  private wanted: Wanted | undefined;
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;
  private firstImport = true;

  constructor(private readonly options: RuntimeCanvasOptions) {
    const mounted = CanvasShell.mount(options.host, options.keysOnCanvas === true);
    this.shell = mounted.shell;
    this.disconnectShell = mounted.disconnect;
    this.viewer = new NavigatedViewer({
      container: this.shell.canvas,
      additionalModules: [OutlineModule, shellModule],
      bpmnRenderer: RENDERER_COLORS,
      textRenderer: CANVAS_TEXT_STYLE,
    });
    this.registry = this.viewer.get<ElementRegistryLike>('elementRegistry');
    this.elements = new DiagramElements(this.registry);
    this.connection = connectDiagramJs(this.shell, this.viewer, {
      contentBounds: () => this.elements.contentBounds(),
      isEmpty: () => false,
    });
    const viewport = this.connection.viewport;
    this.stopPersisting =
      options.remembersView === false
        ? () => undefined
        : persistView(options.stateApi, {
            onChange: (listener) => viewport.onChange(listener),
            getState: () => (this.onTopPlane() ? viewport.getState() : undefined),
          });
    this.viewer.get<EventBusLike>('eventBus').on('element.click', ({ element }) => {
      const target = DiagramElements.selectableTarget(element);
      if (target !== undefined) {
        options.onSelectElement(target.id);
      }
    });
    this.markFocusByPointer();
  }

  update(xml: string, decorations: Decorations): Promise<void> {
    this.wanted = { xml, decorations };
    this.queue = this.queue.then(() => this.sync());
    return this.queue;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPersisting();
    this.layer?.clear();
    this.viewer.destroy();
    this.shell.destroy();
    this.disconnectShell();
  }

  private markFocusByPointer(): void {
    const canvas = this.shell.canvas;
    canvas.addEventListener(
      'pointerdown',
      () => {
        canvas.dataset.focusByPointer = '';
      },
      { capture: true },
    );
    canvas.addEventListener('focusout', () => {
      if (canvas.ownerDocument.hasFocus()) {
        delete canvas.dataset.focusByPointer;
      }
    });
  }

  private onTopPlane(): boolean {
    const root = this.viewer.get<RootedCanvasLike>('canvas').getRootElement();
    return root.businessObject?.$instanceOf?.('bpmn:SubProcess') !== true;
  }

  private async sync(): Promise<void> {
    const wanted = this.wanted;
    if (wanted === undefined || this.destroyed) {
      return;
    }
    if (wanted.xml !== this.importedXml && !(await this.importDiagram(wanted.xml))) {
      return;
    }
    this.layer?.apply(this.wanted?.decorations ?? wanted.decorations);
  }

  private async importDiagram(xml: string): Promise<boolean> {
    try {
      await this.viewer.importXML(xml);
    } catch (error) {
      this.importedXml = undefined;
      this.options.onImportFailed(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.importedXml = xml;
    CanvasRoles.assign(this.shell.canvas);
    const names = this.elements.names();
    this.layer?.clear();
    this.layer = new DecorationLayer(
      {
        overlays: this.viewer.get<OverlaysLike>('overlays'),
        selection: this.viewer.get<SelectionLike>('selection'),
        canvas: this.viewer.get<CanvasMarkersLike>('canvas'),
        registry: this.registry,
        names,
      },
      this.options.onSelectElement,
      this.options.onOpenCall,
      this.options.onOpenCode,
    );
    this.restoreView();
    this.options.onImported(names);
    return true;
  }

  private restoreView(): void {
    const remembered = this.firstImport && this.options.remembersView !== false;
    const stored = remembered ? readShellState(this.options.stateApi).view : undefined;
    this.firstImport = false;
    if (stored === undefined) {
      this.connection.viewport.afterImport();
      return;
    }
    this.connection.viewport.setState(stored);
  }
}
