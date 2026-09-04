import { useLocalCwi } from '../localCwi/LocalCwiHost'

/** Flags to spread into 1sat asset action inputs. */
export function useActionFlags(): { useOneSatModule: boolean } {
	const { useOneSatModule, localEnabled } = useLocalCwi()
	return {
		useOneSatModule: localEnabled && useOneSatModule,
	}
}
