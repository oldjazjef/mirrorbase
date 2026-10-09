import { Directive } from '@angular/core';
import { HlmSeparator } from '@dbreplicator/ui/separator';
import { classes } from '@dbreplicator/ui/utils';

@Directive({
	selector: '[hlmSidebarSeparator],hlm-sidebar-separator',
	hostDirectives: [HlmSeparator],
	host: {
		'data-slot': 'sidebar-separator',
		'data-sidebar': 'separator',
	},
})
export class HlmSidebarSeparator {
	constructor() {
		classes(() => 'bg-sidebar-border mx-2 w-auto');
	}
}
