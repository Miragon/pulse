import type { BoardDefinition, BoardTile, BoardWidget, RefusedWidget } from "./board-definition.js"

export class BoardTiles {
  static of(board: BoardDefinition): readonly (readonly BoardTile[])[] {
    if (board.tenants === undefined) {
      return board.rows
    }
    return board.rows.map((row) =>
      row.map((tile) => ("refused" in tile ? tile : BoardTiles.withTenants(tile))),
    )
  }

  private static withTenants({ widget, title }: BoardWidget): RefusedWidget {
    return {
      widget,
      ...(title === undefined ? {} : { title }),
      refused: [{ path: "tenants", code: "tenantsNotRead" }],
    }
  }
}
