/**
 * Patrón Specification: reglas de negocio pequeñas que se combinan con `and`, `or` y `not`.
 * Los filtros de movimientos las usan; cada adaptador (SQLite, Postgres) las traduce a su consulta.
 */
export interface Specification<T> {
  isSatisfiedBy(candidate: T): boolean;
}

export const spec = <T>(test: (candidate: T) => boolean): Specification<T> => ({
  isSatisfiedBy: test,
});

export const allOf = <T>(...specs: readonly Specification<T>[]): Specification<T> =>
  spec((c) => specs.every((s) => s.isSatisfiedBy(c)));

export const anyOf = <T>(...specs: readonly Specification<T>[]): Specification<T> =>
  spec((c) => specs.some((s) => s.isSatisfiedBy(c)));

export const not = <T>(inner: Specification<T>): Specification<T> =>
  spec((c) => !inner.isSatisfiedBy(c));
