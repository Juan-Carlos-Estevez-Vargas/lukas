/**
 * Error de dominio con un código estable que la API y la app pueden traducir.
 * Representa una violación de regla de negocio, no un fallo de infraestructura.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
