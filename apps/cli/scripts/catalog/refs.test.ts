import { describe, expect, it } from 'vitest';
import type { OpenApiDocument } from './openapi.js';
import { readPatchedSpec } from './files.js';
import { assertResolvableRefs, collectRefs } from './refs.js';
import { buildCatalog } from './build-catalog.js';
import { SPEC_URL } from './render.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function spec(schemas: Record<string, unknown>, body: unknown): OpenApiDocument {
  return {
    info: { title: 't', version: '1' },
    paths: {
      '/thing': {
        post: {
          operationId: 'createThing',
          tags: ['Thing'],
          requestBody: { content: { 'application/json': { schema: body } } },
        },
      },
    },
    components: { schemas: schemas as Record<string, Record<string, unknown>> },
  };
}

describe('collectRefs', () => {
  it('finds references at every depth, in arrays too', () => {
    expect(
      collectRefs({ a: ref('A'), b: [{ items: ref('B') }], c: { allOf: [ref('C')] }, d: 'x' }),
    ).toEqual(['#/components/schemas/A', '#/components/schemas/B', '#/components/schemas/C']);
  });
});

describe('assertResolvableRefs', () => {
  it('accepts references with a target', () => {
    expect(() => {
      assertResolvableRefs(spec({ Thing: { type: 'object' } }, ref('Thing')));
    }).not.toThrow();
  });

  it('names the operation that uses a dangling body reference', () => {
    expect(() => {
      assertResolvableRefs(spec({ Other: { type: 'object' } }, ref('StartProcessInstanceDto')));
    }).toThrow(
      new Error(
        'Unresolvable $ref #/components/schemas/StartProcessInstanceDto (used by createThing)',
      ),
    );
  });

  it('names the component that uses a dangling reference', () => {
    expect(() => {
      assertResolvableRefs(spec({ Thing: { properties: { x: ref('Gone') } } }, ref('Thing')));
    }).toThrow(
      new Error('Unresolvable $ref #/components/schemas/Gone (used by #/components/schemas/Thing)'),
    );
  });

  it('rejects references outside the components and inherited names', () => {
    expect(() => {
      assertResolvableRefs(spec({}, { $ref: 'other.json#/Thing' }));
    }).toThrow('Unresolvable $ref other.json#/Thing');
    expect(() => {
      assertResolvableRefs(spec({}, ref('constructor')));
    }).toThrow('Unresolvable $ref #/components/schemas/constructor');
  });

  it('lists every dangling reference of an owner once', () => {
    expect(() => {
      assertResolvableRefs(spec({}, { allOf: [ref('A'), ref('B'), ref('A')] }));
    }).toThrow(
      new Error(
        'Unresolvable $ref #/components/schemas/A, #/components/schemas/B (used by createThing)',
      ),
    );
  });

  it('rejects pointers below a component and other documents with the same path', () => {
    const schemas = { Thing: { properties: { x: { type: 'string' } } } };
    expect(() => {
      assertResolvableRefs(spec(schemas, { $ref: '#/components/schemas/Thing/properties/x' }));
    }).toThrow('Unresolvable $ref #/components/schemas/Thing/properties/x');
    expect(() => {
      assertResolvableRefs(spec(schemas, { $ref: 'other.json#/components/schemas/Thing' }));
    }).toThrow('Unresolvable $ref other.json#/components/schemas/Thing');
  });

  it('rejects component kinds that are missing or not objects', () => {
    const withNull = {
      ...spec({}, { $ref: '#/components/responses/Ok' }),
      components: { schemas: {}, responses: null },
    } as unknown as OpenApiDocument;
    expect(() => {
      assertResolvableRefs(withNull);
    }).toThrow('Unresolvable $ref #/components/responses/Ok');
    expect(() => {
      assertResolvableRefs(spec({}, { $ref: '#/components/examples/Ok' }));
    }).toThrow('Unresolvable $ref #/components/examples/Ok');
  });

  it('names path level entries by key and path', () => {
    const document: OpenApiDocument = {
      info: { title: 't', version: '1' },
      paths: {
        '/thing': { summary: null, parameters: [{ $ref: '#/components/parameters/Gone' }] },
      },
    };
    expect(() => {
      assertResolvableRefs(document);
    }).toThrow(
      new Error('Unresolvable $ref #/components/parameters/Gone (used by parameters /thing)'),
    );
  });

  it('makes buildCatalog fail when a body schema was renamed upstream', () => {
    const real = readPatchedSpec();
    const schemas = { ...real.components?.schemas };
    schemas.RenamedStartDto = schemas.StartProcessInstanceDto ?? {};
    delete schemas.StartProcessInstanceDto;
    const broken = { ...real, components: { ...real.components, schemas } };
    expect(() => buildCatalog(broken, SPEC_URL)).toThrow(
      /^Unresolvable \$ref #\/components\/schemas\/StartProcessInstanceDto \(used by /,
    );
  });
});
