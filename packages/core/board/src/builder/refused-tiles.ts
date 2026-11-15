import type { RefusedWidget } from "../format/board-definition.js"
import type { RefusedModel } from "./board-model.js"

export class RefusedTiles {
  static of({ widget, title, refused }: RefusedWidget): RefusedModel {
    return {
      kind: "refused",
      ...(widget === undefined ? {} : { widget }),
      ...(title === undefined ? {} : { title }),
      problems: refused,
    }
  }
}
