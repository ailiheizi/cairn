package command

const (
	OpStatusGet               = "status.get"
	OpDoctorCheck             = "doctor.check"
	OpCapabilityList          = "capability.list"
	OpConfigGet               = "config.get"
	OpConfigUpdate            = "config.update"
	OpSnapshotList            = "snapshot.list"
	OpSourceList              = "source.list"
	OpSourceStagingClean      = "source.staging_clean"
	OpSnapshotDiff            = "snapshot.diff"
	OpSnapshotVerify          = "snapshot.verify"
	OpPlanIngest              = "plan.ingest"
	OpPlanRevise              = "plan.revise"
	OpPlanAbandon             = "plan.abandon"
	OpPlanRestore             = "plan.restore"
	OpPlanGet                 = "plan.get"
	OpPlanApply               = "plan.apply"
	OpJobEvents               = "job.events"
	OpJobCancel               = "job.cancel"
	OpJobList                 = "job.list"
	OpRecoveryExport          = "recovery.export"
	OpRecoveryAnchorExport    = "recovery.anchor.export"
	OpNamespaceList           = "namespace.list"
	OpContentList             = "content.list"
	OpNamespaceResolve        = "namespace.resolve"
	OpNamespaceStat           = "namespace.stat"
	OpNamespaceReadlink       = "namespace.readlink"
	OpRepresentationList      = "representation.list"
	OpContentOpen             = "content.open"
	OpContentRead             = "content.read"
	OpContentClose            = "content.close"
	OpAnnotationList          = "annotation.list"
	OpAnnotationUpsert        = "annotation.upsert"
	OpAnnotationDelete        = "annotation.delete"
	OpAnnotationExport        = "annotation.export"
	OpAnnotationImport        = "annotation.import"
	OpAnnotationTagPlan       = "annotation.tag_plan"
	OpAnnotationTagApply      = "annotation.tag_apply"
	OpSearchQuery             = "search.query"
	OpSearchRebuild           = "search.rebuild"
	OpSemanticBundleInstall   = "semantic.bundle.install"
	OpSemanticProviderInstall = "semantic.provider.install"
	OpSemanticProviderList    = "semantic.provider.list"
	OpEgressGrantCreate       = "egress.grant.create"
	OpEgressGrantList         = "egress.grant.list"
	OpEgressGrantRevoke       = "egress.grant.revoke"
	OpImageBundleInstall      = "image.bundle.install"
	OpAudioList               = "audio.list"
	OpBooksList               = "books.list"
	OpSimilarityScan          = "similarity.scan"
	OpSimilarityGroups        = "similarity.groups"
	OpSubjectFactsList        = "subject.facts.list"
	OpDescriptionList         = "description.list"
	OpDescriptionGet          = "description.get"
	OpDescriptionCreate       = "description.create"
	OpDescriptionGenerate     = "description.generate"
	OpMaterialOrganize        = "material.organize"
	OpRecoveryImport          = "recovery.import"
	OpRecoveryTokenExport     = "recovery.token.export"
	OpViewSave                = "view.save"
	OpViewGet                 = "view.get"
	OpViewEvaluate            = "view.evaluate"
	OpViewList                = "view.list"
	OpExportList              = "export.list"
	OpExportPlan              = "export.plan"
	OpExportApply             = "export.apply"
	OpExportVerify            = "export.verify"
)

func KnownOperations() []string {
	return []string{
		OpStatusGet,
		OpDoctorCheck,
		OpCapabilityList,
		OpConfigGet,
		OpConfigUpdate,
		OpSnapshotList,
		OpSourceList,
		OpSourceStagingClean,
		OpSnapshotDiff,
		OpSnapshotVerify,
		OpPlanIngest,
		OpPlanRevise,
		OpPlanAbandon,
		OpPlanRestore,
		OpPlanGet,
		OpPlanApply,
		OpJobEvents,
		OpJobCancel,
		OpJobList,
		OpRecoveryExport,
		OpRecoveryAnchorExport,
		OpNamespaceList,
		OpContentList,
		OpNamespaceResolve,
		OpNamespaceStat,
		OpNamespaceReadlink,
		OpRepresentationList,
		OpContentOpen,
		OpContentRead,
		OpContentClose,
		OpAnnotationList,
		OpAnnotationUpsert,
		OpAnnotationDelete,
		OpAnnotationExport,
		OpAnnotationImport,
		OpAnnotationTagPlan,
		OpAnnotationTagApply,
		OpSearchQuery,
		OpSearchRebuild,
		OpSemanticBundleInstall,
		OpSemanticProviderInstall,
		OpSemanticProviderList,
		OpEgressGrantCreate,
		OpEgressGrantList,
		OpEgressGrantRevoke,
		OpImageBundleInstall,
		OpAudioList,
		OpBooksList,
		OpSimilarityScan,
		OpSimilarityGroups,
		OpSubjectFactsList,
		OpDescriptionList,
		OpDescriptionGet,
		OpDescriptionCreate,
		OpDescriptionGenerate,
		OpMaterialOrganize,
		OpRecoveryImport,
		OpRecoveryTokenExport,
		OpViewSave,
		OpViewGet,
		OpViewEvaluate,
		OpViewList,
		OpExportList,
		OpExportPlan,
		OpExportApply,
		OpExportVerify,
	}
}

func IsKnown(operation string) bool {
	for _, candidate := range KnownOperations() {
		if candidate == operation {
			return true
		}
	}
	return false
}
