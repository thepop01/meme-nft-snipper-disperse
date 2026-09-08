\# How Umi Works

Umi is a web-based minting bot that broadcast transactions from the servers instead of the user's machine.



This requires us to control your private keys at the mint and we've always been opened about it , we never hid it from anyone when people asked about it.

&#x20;

\## Ok you guys store pks, but how is it safe?

Umi stores your private keys in 2 ways depending on the context:

1\. When you import or create a wallet

2\. When you schedule a mint

&#x20; 

\## When you import or create a wallet

When you import or create a wallet, your private keys will be encrypted using your connecting wallet (for example MetaMask) and then stored (still encrypted) in our database for synchronisation (so you can access wallets on your mobile and computer easily). This means that in that case, your private key is \*\*UNREADABLE\*\* by anyone, \*\*NOT EVEN ME\*\*. As a matter of fact I couldn't even help you if you lost access to your connecting wallet and offered me 1 billion dollars <:shrug:1315070892656820315> 



It's in that sense that Umi is non-custodial, might be bad wording but definitely not a lie.



The ONLY way I could rug those wallets is if I pushed an update that would trick you into signing a message with your Metamask (for example) and then steal this signature to decrypt your private key (or steal decrypted wallets directly from your browser's memory after you decrypted them).



But this would be:

1\. incredibly stupid on my end, why spend +9 months building a bot that could earn me tens of thousands of dollars a month with all those features just to rug it?

2\. VERY EASILY detectable by any dev with web knowledge. ALL the frontend code is available in the browser along with all the requests being made, you can literally spy on Umi if you wanted to and there is nothing I could do about it. If an update was pushed that would start siphoning private keys it would be very easy to prove it and basically destroy my reputation.



(Some links showing how to check requests and source code in browser dev tools)

\- https://sammie1999.medium.com/webscraping-101-how-to-find-the-right-apis-using-chrome-developer-tools-and-postman-79bfd06e64b2

\- https://www.wikihow.com/View-Source-Code

## When you schedule a mint

When you schedule a mint, it's a different story. In that case, Umi needs to know your private key to be able to sign the transaction when the time comes. For this to work you indeed need to send your private key in clear text to our backend server over HTTPS and we need to store it. We never ever hid that from anyone (again see here https://discord.com/channels/1281586674576654351/1313489784731078716/1344389042153848924), especially with how easy it would be to find out just like <@980164279732928592> did in his thread.

&#x20; 

Now you may wonder why <@980164279732928592> was able to see his private key in clear text being sent to our servers and how are we really storing pks in DB.

For the first part of the question, \_"why was he able to see his private key in clear text being sent to our servers"\_, the answer is simple:



> 1. It's \*\*HIS\*\* pk that he was trying to schedule a mint with not one he got from the db  

> 2. It's not really clear text as it's sent over HTTPS



When you connect to a website over HTTPS, your browser will encrypt the data being sent to the server using the \[TLS protocol](https://fr.wikipedia.org/wiki/Transport\_Layer\_Security). It's automatic and implemented within every web-browser by default. This means that even tho YOU can see the data being sent in clear text in your browser dev tools, no one else can read it, not even a proxy browsers as <@980164279732928592> claimed or someone listening the network on a cafe's public Wifi. Everything we send (not only the pks) is encrypted using the TLS protocol (ie every website that starts with `https://` ) which is the gold standard for secure communication on the web.





Here are some links backing this up:

\- \[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication\_Cheat\_Sheet.html)

\- \[Is it ok to send plain text passwords over HTTPS?](https://security.stackexchange.com/questions/110415/is-it-ok-to-send-plain-text-passwords-over-https)

\- \[Plain text passwords over HTTPS](https://stackoverflow.com/questions/962187/plain-text-passwords-over-https)



The fact that he was so confident in his claims that Umi is unsafe is laughable, and shows either how little he knows about security or how malicious he was trying to be.

## Ok it's encrypted when sent but how is it stored in the database?

First, it's important to state that <@980164279732928592> has NO IDEA how Umi stores data in the database. He just saw his pk in clear text being sent to the server and assumed wrongly that it was stored in clear text in the database because he is bad faith and/or retarded but in reality he has no clue.



When we receive your private key in the server we use a secret key managed by a service called \[AWS Secrets Manager](https://aws.amazon.com/fr/secrets-manager/) to encrypt it BEFORE storing it in the database. \*\*NO SENSITIVE DATA IS EVER STORED IN CLEAR TEXT\*\* in DB nor in logs, \*\*EVERYTHING IS ENCRYPTED\*\*; doing otherwise would be an \*\*INSANE\*\* security risk. And I can prove it \*\*LIVE\*\*, to whoever is doubting me, I have nothing to hide.



When the mint comes, we simply load your private key from the database, decrypt it in memory using the same secret key managed by \[AWS Secrets Manager](https://aws.amazon.com/fr/secrets-manager/), sign the transaction and broadcast it to the network.



That's it. Once the mint is done, everything gets wiped from the database and your private key disappears in the void.



> Worth to mention also that extra care has been take to not log the private key in the server logs, and that only me (<@222452423522779136>) can deploy code to production, and has access to the AWS secret key. Not even a rogue dev could steal your private keys.

