export {
	type ArgsWithPendingSpends,
	type ResolvedSpend,
	type Spend,
	PENDING_RESOLVED_SPENDS_KEY,
	labelsFromSpends,
	mergeResolvedSpends,
	spendToLabel,
	spendsFromLabels,
	// deprecated aliases
	type BasketSpendTarget,
	type OutpointSpendTarget,
	type SpendTarget,
	labelsFromSpendTargets,
	spendTargetToLabel,
	spendTargetsFromLabels,
} from './spendTargets.js'
export {
	buildPurchaseUnlockingScript,
	buildSpendsForResolved,
	buildSpendsForTargets,
	materializeSpends,
	resolveSpendTargets,
	unlockByScript,
} from './unlockInput.js'
export {
	type PipelineOptions,
	embellishCreateActionArgs,
	finishCreateAction,
	runCreateActionPipeline,
} from './runPipeline.js'
