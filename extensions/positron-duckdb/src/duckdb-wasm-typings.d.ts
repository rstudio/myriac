// Declare .wasm files as a module
declare module '*.wasm' {
	const value: string;
	export default value;
}

// Declare .worker.cjs files as a module
declare module '*.worker.cjs' {
	const value: string;
	export default value;
}
