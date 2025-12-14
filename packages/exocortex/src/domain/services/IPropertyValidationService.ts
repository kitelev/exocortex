export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export interface IPropertyValidationService {
  validatePropertyDomain(propertyName: string, assetClass: string): Promise<ValidationResult>;
  validatePropertyRange(propertyName: string, propertyValue: any): Promise<ValidationResult>;
}
