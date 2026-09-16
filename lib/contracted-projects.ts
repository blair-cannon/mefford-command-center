export type ProjectContractState = {
  status?: unknown;
  ownerContractStatus?: unknown;
  owner_contract_status?: unknown;
  contractStatus?: unknown;
  contractAuthorized?: boolean;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function hasExecutedOwnerContract(project: ProjectContractState) {
  if (project.contractAuthorized === false) return false;
  const contractStatus =
    project.ownerContractStatus ??
    project.owner_contract_status ??
    project.contractStatus;
  return normalized(contractStatus) === "executed";
}

export function isContractedActiveProject(project: ProjectContractState) {
  return normalized(project.status) === "active" && hasExecutedOwnerContract(project);
}

export function needsOwnerContractSignature(project: ProjectContractState) {
  return normalized(project.status) === "active" && !hasExecutedOwnerContract(project);
}
