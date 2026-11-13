import type { ReactElement } from "react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Progress,
  Skeleton,
  Switch,
  TabCount,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "./index.js"

/**
 * One SSR render case (see `render-cases.tsx`, which aggregates this module's
 * primitive cases with the composed and provider ones, split only to respect
 * the 400-effective-line budget; the exported surface is `RENDER_CASES` there).
 */
export interface RenderCase {
  /** The name of the component this case covers. */
  name: string
  /** Distinctive text expected in the SSR markup, when the component can carry one. */
  marker?: string
  /** Renders the component with minimal realistic props. */
  render: () => ReactElement
}

const noop = (): void => {}

/** SSR render cases for the shadcn primitives. */
export const PRIMITIVE_RENDER_CASES: RenderCase[] = [
  {
    name: "Card",
    marker: "RC:Card",
    render: () => (
      <Card size="sm">
        <CardHeader>
          <CardTitle>RC:Card</CardTitle>
          <CardDescription>Order summary</CardDescription>
          <CardAction>
            <Badge variant="outline">new</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>Three orders this week.</CardContent>
        <CardFooter>Updated just now</CardFooter>
      </Card>
    ),
  },
  {
    name: "Badge",
    marker: "RC:Badge",
    render: () => <Badge variant="secondary">RC:Badge</Badge>,
  },
  {
    name: "Button",
    marker: "RC:Button",
    render: () => (
      <Button variant="outline" size="sm" onClick={noop}>
        RC:Button
      </Button>
    ),
  },
  {
    // The marker lands in the placeholder/value attributes of the markup.
    name: "Input",
    marker: "RC:Input",
    render: () => <Input type="text" placeholder="RC:Input" defaultValue="42" onChange={noop} />,
  },
  {
    // The marker lands in the placeholder attribute of the markup.
    name: "Textarea",
    marker: "RC:Textarea",
    render: () => <Textarea placeholder="RC:Textarea" defaultValue="{}" onChange={noop} />,
  },
  {
    name: "Label",
    marker: "RC:Label",
    render: () => <Label htmlFor="rc-label">RC:Label</Label>,
  },
  {
    // The marker lands in the aria-label attribute; the box is checked, so its mark renders.
    name: "Checkbox",
    marker: "RC:Checkbox",
    render: () => <Checkbox defaultChecked aria-label="RC:Checkbox" onCheckedChange={noop} />,
  },
  {
    // The markers land in the aria-label and aria-valuetext attributes.
    name: "Progress",
    marker: "RC:Progress",
    render: () => <Progress aria-label="Archiving" value={3} max={12} valueText="RC:Progress" />,
  },
  {
    // The marker lands in the aria-label attribute of the markup.
    name: "Switch",
    marker: "RC:Switch",
    render: () => <Switch defaultChecked aria-label="RC:Switch" onCheckedChange={noop} />,
  },
  {
    name: "Table",
    marker: "RC:Table",
    render: () => (
      <Table>
        <TableCaption>RC:Table</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>o-1001</TableCell>
            <TableCell>shipped</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>1 order</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    ),
  },
  {
    name: "Tabs",
    marker: "RC:Tabs",
    render: () => (
      <Tabs defaultValue="overview" onValueChange={noop}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="detail">Detail</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">RC:Tabs</TabsContent>
        <TabsContent value="detail">Per-order detail</TabsContent>
      </Tabs>
    ),
  },
  {
    // A view's tab bar: counts exact, capped and unknown (their words from the catalog), and an
    // aside after the tab list.
    name: "Tabs (line)",
    marker: "RC:TabsAside",
    render: () => (
      <Tabs defaultValue="orders" onValueChange={noop}>
        <TabsList variant="line" aside={<span>RC:TabsAside</span>}>
          <TabsTrigger value="orders">
            Orders
            <TabCount count={12} />
          </TabsTrigger>
          <TabsTrigger value="returns">
            Returns
            <TabCount count={{ atLeast: 500 }} />
          </TabsTrigger>
          <TabsTrigger value="claims">
            Claims
            <TabCount count={null} />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    ),
  },
  {
    // SSR limitation: DialogContent renders through a Radix portal targeting
    // document.body, so the modal body cannot SSR even with `open`: the
    // trigger is the SSR surface. Portal content needs a browser host.
    name: "Dialog",
    marker: "RC:Dialog",
    render: () => (
      <Dialog open onOpenChange={noop}>
        <DialogTrigger>RC:Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive order?</DialogTitle>
            <DialogDescription>The order can be restored later.</DialogDescription>
          </DialogHeader>
          <DialogBody>Order 4711 leaves the list.</DialogBody>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: "Alert",
    marker: "RC:Alert",
    render: () => (
      <Alert variant="danger">
        <AlertTitle>RC:Alert</AlertTitle>
        <AlertDescription>The engine rejected the job.</AlertDescription>
      </Alert>
    ),
  },
  {
    // Pure placeholder box: no text content to mark.
    name: "Skeleton",
    render: () => <Skeleton className="h-6 w-32" />,
  },
]
