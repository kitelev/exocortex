/**
 * RdfButton - Generic button component rendered from RDF definitions
 *
 * Replaces 18 specialized button components with a single generic component
 * that receives its configuration from RDF definitions. The button:
 * - Renders label from RDF
 * - Renders icon from RDF (optional)
 * - Applies variant styling from RDF
 * - Triggers ActionBridge → ActionInterpreter on click
 *
 * @see https://github.com/kitelev/exocortex/issues/2004
 * @module presentation/components
 * @since 14.0.0
 */

import React from "react";

/**
 * Button definition loaded from RDF.
 *
 * Contains all properties needed to render a button:
 * - uri: Unique identifier for the button in RDF
 * - label: Display text for the button
 * - icon: Optional Lucide icon name
 * - variant: Button style variant
 * - tooltip: Optional hover text
 * - action: Action URI to execute on click
 */
export interface RdfButtonDefinition {
  /** Unique URI identifier from RDF (e.g., "exo-ui:StartButton") */
  uri: string;

  /** Display label for the button */
  label: string;

  /** Optional Lucide icon name (e.g., "play", "check") */
  icon?: string;

  /** Button variant for styling */
  variant?: "primary" | "secondary" | "success" | "warning" | "danger";

  /** Optional tooltip text shown on hover */
  tooltip?: string;

  /** Action URI to execute when button is clicked */
  action: string;
}

/**
 * Props for RdfButton component.
 */
export interface RdfButtonProps {
  /** Button definition from RDF */
  definition: RdfButtonDefinition;

  /** Click handler that receives the button definition */
  onClick: (definition: RdfButtonDefinition) => void | Promise<void>;

  /** Whether the button is disabled */
  disabled?: boolean;

  /** Whether the button is in loading state */
  loading?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * RdfButton Component
 *
 * Generic button component that renders any button from RDF definition.
 * Designed to replace 18 specialized button components with a single
 * flexible component driven by RDF data.
 *
 * Features:
 * - Label and icon from RDF definition
 * - Variant styling (primary, secondary, success, warning, danger)
 * - Tooltip support
 * - Loading and disabled states
 * - Event handling with proper event propagation control
 *
 * @example
 * ```tsx
 * const buttonDef: RdfButtonDefinition = {
 *   uri: "exo-ui:StartButton",
 *   label: "Start",
 *   icon: "play",
 *   variant: "primary",
 *   action: "exo-ui:StartAction",
 * };
 *
 * <RdfButton
 *   definition={buttonDef}
 *   onClick={async (def) => {
 *     await actionInterpreter.execute(def.action, context);
 *   }}
 * />
 * ```
 */
export const RdfButton: React.FC<RdfButtonProps> = ({
  definition,
  onClick,
  disabled = false,
  loading = false,
  className,
}) => {
  const { label, icon, variant = "secondary", tooltip } = definition;

  const isDisabled = disabled || loading;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDisabled) {
      return;
    }

    await onClick(definition);
  };

  const classNames = [
    "exocortex-rdf-button",
    `exocortex-rdf-button--${variant}`,
    isDisabled ? "exocortex-rdf-button--disabled" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classNames}
      onClick={handleClick}
      disabled={isDisabled}
      title={tooltip}
    >
      {loading && <span className="exocortex-rdf-button-loading" />}
      {icon && !loading && <span className="exocortex-rdf-button-icon">{icon}</span>}
      {label}
    </button>
  );
};
