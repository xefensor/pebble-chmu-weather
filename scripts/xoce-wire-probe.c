/* Decode with the consumer's pinned native header, never a parallel JS codec. */
#include <stdio.h>
#include <stdlib.h>
#include "pebble-watchface-core/complication_data.h"
static void string(const char *s){putchar('"');for(;*s;++s){unsigned char c=(unsigned char)*s;if(c=='"'||c=='\\'){putchar('\\');putchar(c);}else if(c<32)printf("\\u%04x",c);else putchar(c);}putchar('"');}
int main(int argc,char **argv){
 FILE *input=argc>2?fopen(argv[2],"rb"):stdin;if(!input)return 3;
 uint8_t data[COMPLICATION_MAX_BYTES+1];size_t n=fread(data,1,sizeof(data),input);if(input!=stdin)fclose(input);ComplicationSet value;
 if(!complications_read(data,n,&value)){fprintf(stderr,"decode failed bytes=%lu first=%u\n",(unsigned long)n,n?data[0]:0);return 2;}
 time_t now=argc>1?(time_t)strtoul(argv[1],NULL,10):0;
 putchar('[');for(unsigned i=0;i<COMPLICATION_SLOT_COUNT;++i){const ComplicationSlot *s=&value.slots[i];if(i)putchar(',');
 printf("{\"status\":%u,\"fresh\":%s,\"kind\":%u,\"source\":%u,\"detail\":%u,\"qualifiers\":%u,\"value\":%.17g,\"observedAt\":%u,\"confirmedAt\":%u,\"validUntil\":%u,\"displayKind\":%u,\"unit\":",s->status,complication_is_fresh(s,now)?"true":"false",s->semantic_kind,s->source_kind,s->detail,s->qualifiers,s->numeric_value,s->observed_at,s->confirmed_at,s->valid_until,s->display_kind);string(s->unit);printf(",\"text\":");string(s->text);printf(",\"label\":");string(s->label);putchar('}');
 }puts("]");return 0;
}
