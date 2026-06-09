# Nokira-Internet-Speed-Test
Simple Internet Speed Test Project.     
**This README covers tech stack, website link, and why Nokira, along with licensing.**

## Tech Stack
This features cloudflare workers, cloudflare pages, and non-framework HTML/CSS/JS.    

## Website link
Link to the actual website is [here](https://nokira.pages.dev/): https://nokira.pages.dev/      
Link to the worker I used is [here](https://nokira-api.live-by-unix.workers.dev/): https://nokira-api.live-by-unix.workers.dev/    

## Why Nokira   
Most "internet speed tests", most famously Google's/Measurement Lab's Internet Speed Test use lab based results., my thing using litreal post requests to a Cloudflare worker to simulate actual speed. Unlike others which do a lab simulation of your internet. 
Nokira provides many more results, as well as email button (opens default email client) and copy results button, along with guessing internet provider from results (no actual server), which was a little fun feature I added.    

## Licensing
Under MIT license. 

## Why are some numbers so different?
Because Nokira simulates what your apps should feel, while others use lab/theoretical speeds.   
So if you want what your apps and website should feel, use Nokira.    
However if you want the theoretical speeds that basically your apps/websites would never feel, use others. And I am 100% supportive of that. 
