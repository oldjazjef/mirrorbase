import { Directive } from '@angular/core';
import { HlmInput } from '@dbreplicator/ui/input';
import { classes } from '@dbreplicator/ui/utils';

@Directive({
	selector: 'input[hlmInputGroupInput]',
	hostDirectives: [HlmInput],
	host: { 'data-slot': 'input-group-control' },
})
export class HlmInputGroupInput {
	constructor() {
		classes(() => `rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 data-[matches-spartan-invalid=true]:ring-0 dark:bg-transparent flex-1`);
	}
}
