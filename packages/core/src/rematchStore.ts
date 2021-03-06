/* eslint-disable @typescript-eslint/ban-ts-ignore */
import { Middleware } from 'redux'
import {
	Action,
	Config,
	ExposedFunction,
	Models,
	NamedModel,
	ObjectNotAFunction,
	Plugin,
	RematchBag,
	RematchStore,
} from './types'
import createReduxStore, {
	createModelReducer,
	createRootReducer,
} from './reduxStore'
import createDispatcher from './dispatcher'
import { validateModel } from './validate'
import createRematchBag from './bag'

export default function createRematchStore<
	TModels extends Models,
	TExtraModels extends Models
>(config: Config<TModels>): RematchStore<TModels & TExtraModels> {
	// setup rematch 'bag' for storing useful values and functions
	const bag = createRematchBag(config)

	// add middleware for handling effects
	bag.reduxConfig.middlewares.push(createEffectsMiddleware(bag))

	// collect middlewares from plugins
	bag.forEachPlugin('createMiddleware', (createMiddleware) => {
		bag.reduxConfig.middlewares.push(createMiddleware(bag))
	})

	const reduxStore = createReduxStore(bag)

	let rematchStore = {
		...reduxStore,
		name: config.name,
		addModel(model: NamedModel) {
			validateModel(model)
			createModelReducer(bag, model)
			prepareModel<TModels & TExtraModels, typeof model>(this, bag, model)
			this.replaceReducer(createRootReducer(bag))
			reduxStore.dispatch({ type: '@@redux/REPLACE' })
		},
	} as RematchStore<TModels & TExtraModels>

	addExposed(rematchStore, config.plugins)

	rematchStore.addModel.bind(rematchStore)

	// generate dispatch[modelName][actionName] for all reducers and effects
	for (const model of bag.models) {
		prepareModel<TModels & TExtraModels, typeof model>(rematchStore, bag, model)
	}

	bag.forEachPlugin('onStoreCreated', (onStoreCreated) => {
		rematchStore = onStoreCreated(rematchStore, bag) || rematchStore
	})

	return rematchStore
}

function createEffectsMiddleware(bag: RematchBag): Middleware {
	return (store) => (next) => (action: Action): any => {
		if (action.type in bag.effects) {
			// first run reducer action if exists
			next(action)

			// then run the effect and return its result
			// @ts-ignore
			return bag.effects[action.type](action.payload, store.getState())
		}

		return next(action)
	}
}

function prepareModel<TModels extends Models, TModel extends NamedModel>(
	rematchStore: RematchStore<TModels>,
	bag: RematchBag,
	model: TModel
): void {
	// @ts-ignore
	rematchStore.dispatch[model.name] = createDispatcher<TModels, TModel>(
		rematchStore,
		bag,
		model
	)

	bag.forEachPlugin('onModel', (onModel) => onModel(model, rematchStore))
}

/**
 * Adds properties exposed by plugins into the Rematch instance. If a exposed
 * property is a function, it passes rematch as the first argument.
 *
 * If you're implementing a plugin in TypeScript, extend Rematch namespace by
 * adding the properties that you exposed from your plugin.
 */
function addExposed(store: RematchStore<any>, plugins: Plugin[]): void {
	for (const plugin of plugins) {
		if (plugin.exposed) {
			for (const key of Object.keys(plugin.exposed)) {
				const exposedItem = plugin.exposed[key] as
					| ExposedFunction
					| ObjectNotAFunction
				const isExposedFunction = typeof exposedItem === 'function'

				// @ts-ignore
				store[key] = isExposedFunction
					? (...params: any[]): any =>
							(exposedItem as ExposedFunction)(store, ...params)
					: Object.create(plugin.exposed[key])
			}
		}
	}
}
