while true; do
    bash /home/erkki/paul/projects/joule/scripts/start-testnet.sh
    echo "$(date) — gjoule crashed, restarting..." >> /home/erkki/paul/projects/joule/watchdog.log
    sleep 5
done
