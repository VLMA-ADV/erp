export interface ExpansionState {
  expandedClientes: Record<string, boolean>
  expandedContratos: Record<string, boolean>
  expandedCasos: Record<string, boolean>
}

export function hasAnyExpansion(state: ExpansionState): boolean {
  const { expandedClientes, expandedContratos, expandedCasos } = state
  return (
    Object.values(expandedClientes).some(Boolean) ||
    Object.values(expandedContratos).some(Boolean) ||
    Object.values(expandedCasos).some(Boolean)
  )
}

export function clearAllExpansions(): ExpansionState {
  return {
    expandedClientes: {},
    expandedContratos: {},
    expandedCasos: {},
  }
}
